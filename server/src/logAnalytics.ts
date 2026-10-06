import {
  DefaultAzureCredential,
  AzureCliCredential,
  ClientSecretCredential,
  ChainedTokenCredential,
  type TokenCredential
} from "@azure/identity";
import {
  LogsQueryClient,
  LogsQueryResultStatus,
  type LogsTable
} from "@azure/monitor-query-logs";
import { config } from "./config.js";
import { ensureQueryRowLimit } from "./kql.js";
import type { QueryResponse, QueryTable } from "./types.js";

function createAzureCredential(): TokenCredential {
  const tenantId = process.env.AZURE_TENANT_ID?.trim();
  const clientId = process.env.AZURE_CLIENT_ID?.trim();
  const clientSecret = process.env.AZURE_CLIENT_SECRET?.trim();

  const isPlaceholder = (val?: string) =>
    !val ||
    val.includes("your-") ||
    val.startsWith("YOUR_") ||
    val.startsWith("22222222") ||
    val.startsWith("33333333");

  if (tenantId && clientId && clientSecret && !isPlaceholder(tenantId) && !isPlaceholder(clientId) && !isPlaceholder(clientSecret)) {
    console.log("🔐 Azure Log Analytics Auth: Using Service Principal (SPN) credentials.");
    return new ClientSecretCredential(tenantId, clientId, clientSecret);
  }

  // Clean placeholders from process.env so DefaultAzureCredential doesn't fail on bogus variables
  ["AZURE_CLIENT_SECRET", "AZURE_TENANT_ID", "AZURE_CLIENT_ID"].forEach((key) => {
    if (isPlaceholder(process.env[key])) {
      delete process.env[key];
    }
  });

  const validClientId = process.env.AZURE_CLIENT_ID?.trim();
  console.log("🔐 Azure Log Analytics Auth: Using DefaultAzureCredential / Azure CLI credential chain.");
  return new ChainedTokenCredential(
    new DefaultAzureCredential(validClientId ? { managedIdentityClientId: validClientId } : undefined),
    new AzureCliCredential()
  );
}

const credential = createAzureCredential();
const client = new LogsQueryClient(credential);

async function executeLogsQuery(
  queryClient: LogsQueryClient,
  workspaceId: string,
  queryWithLimit: string,
  timespan: string,
  effectiveMaxRows: number,
  originalQuery: string
): Promise<QueryResponse> {
  const result = await queryClient.queryWorkspace(workspaceId, queryWithLimit, {
    duration: timespan
  }, {
    serverTimeoutInSeconds: Math.ceil(config.QUERY_TIMEOUT_MS / 1000),
    includeQueryStatistics: true
  });

  const mapTable = (table: LogsTable) => toQueryTable(table, effectiveMaxRows);

  const tables = result.status === LogsQueryResultStatus.PartialFailure
    ? result.partialTables.map(mapTable)
    : result.tables.map(mapTable);

  const partialMsg = result.status === LogsQueryResultStatus.PartialFailure
    ? (result.partialError?.message || (typeof result.partialError === "string" ? result.partialError : JSON.stringify(result.partialError || {})))
    : undefined;

  if (partialMsg) {
    console.warn(`⚠️ [Azure Log Analytics Warning / Truncation Logged]
  - Workspace ID: ${workspaceId}
  - Timespan: ${timespan}
  - Max Rows Requested: ${effectiveMaxRows}
  - Warning / Partial Error: ${partialMsg}
  - Statistics: ${JSON.stringify(result.statistics || {})}
  - Executed KQL:
${originalQuery}`);
  } else {
    console.log(`✅ [Azure Log Analytics Query Succeeded] Workspace: ${workspaceId} | Timespan: ${timespan} | Max Rows: ${effectiveMaxRows} | Tables Returned: ${tables.length}`);
  }

  return {
    tables,
    partialError: partialMsg,
    statistics: result.statistics
  };
}

export async function queryWorkspaceLogs(args: {
  workspaceId: string;
  query: string;
  timespan: string;
  maxRows?: number;
  userToken?: string;
}): Promise<QueryResponse> {
  const effectiveMaxRows = Math.min(
    args.maxRows && args.maxRows > 0 ? args.maxRows : 1000,
    config.QUERY_MAX_ROWS
  );

  const queryWithLimit = ensureQueryRowLimit(args.query, effectiveMaxRows);

  // If user token is provided, attempt with user token first; if it fails (e.g. invalid audience for SPA login token), fallback to server Service Principal
  if (args.userToken) {
    try {
      const userCredential = {
        getToken: async () => ({
          token: args.userToken!,
          expiresOnTimestamp: Date.now() + 3600 * 1000
        })
      };
      const userQueryClient = new LogsQueryClient(userCredential);
      return await executeLogsQuery(userQueryClient, args.workspaceId, queryWithLimit, args.timespan, effectiveMaxRows, args.query);
    } catch (userErr: any) {
      console.warn("⚠️ User token query failed (user login token might not have Log Analytics audience). Falling back to backend Service Principal credentials:", userErr?.message || userErr);
    }
  }

  try {
    return await executeLogsQuery(client, args.workspaceId, queryWithLimit, args.timespan, effectiveMaxRows, args.query);
  } catch (err) {
    console.error(`❌ [Azure Log Analytics Query Failed]
  - Workspace ID: ${args.workspaceId}
  - Timespan: ${args.timespan}
  - Executed KQL:
${args.query}
  - Error Details:`, err);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("az login") || msg.includes("CredentialUnavailableError") || msg.includes("DefaultAzureCredential")) {
      throw new Error("Azure Authentication Failed: Please verify backend Service Principal (AZURE_CLIENT_ID / AZURE_CLIENT_SECRET / AZURE_TENANT_ID) or Managed Identity in server configuration.");
    }
    throw new Error(`Azure Log Analytics query failed: ${msg}`);
  }
}

function toQueryTable(table: LogsTable, maxRows: number = 1000): QueryTable {
  return {
    name: table.name,
    columns: table.columnDescriptors.map((column) => ({
      name: column.name,
      type: column.type
    })),
    rows: table.rows.slice(0, maxRows)
  };
}
