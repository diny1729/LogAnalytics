import { DefaultAzureCredential, AzureCliCredential, ChainedTokenCredential } from "@azure/identity";
import {
  LogsQueryClient,
  LogsQueryResultStatus,
  type LogsTable
} from "@azure/monitor-query-logs";
import { config } from "./config.js";
import type { QueryResponse, QueryTable } from "./types.js";

// Clean up empty, whitespace, or placeholder env vars so Azure identity falls back to Azure CLI smoothly
["AZURE_CLIENT_SECRET", "AZURE_TENANT_ID", "AZURE_CLIENT_ID"].forEach(key => {
  const val = process.env[key];
  if (!val || !val.trim() || val.startsWith("YOUR_") || val.startsWith("22222222") || val.startsWith("33333333")) {
    delete process.env[key];
  }
});

const credential = new ChainedTokenCredential(
  new DefaultAzureCredential(),
  new AzureCliCredential()
);

const client = new LogsQueryClient(credential);

export async function queryWorkspaceLogs(args: {
  workspaceId: string;
  query: string;
  timespan: string;
  maxRows?: number;
  userToken?: string;
}): Promise<QueryResponse> {
  let queryClient = client;

  if (args.userToken) {
    const userCredential = {
      getToken: async () => ({
        token: args.userToken!,
        expiresOnTimestamp: Date.now() + 3600 * 1000
      })
    };
    queryClient = new LogsQueryClient(userCredential);
  }

  const effectiveMaxRows = Math.min(
    args.maxRows && args.maxRows > 0 ? args.maxRows : 1000,
    config.QUERY_MAX_ROWS
  );

  try {
    const result = await queryClient.queryWorkspace(args.workspaceId, args.query, {
      duration: args.timespan
    }, {
      serverTimeoutInSeconds: Math.ceil(config.QUERY_TIMEOUT_MS / 1000),
      includeQueryStatistics: true
    });

    const mapTable = (table: LogsTable) => toQueryTable(table, effectiveMaxRows);

    const tables = result.status === LogsQueryResultStatus.PartialFailure
      ? result.partialTables.map(mapTable)
      : result.tables.map(mapTable);

    return {
      tables,
      partialError:
        result.status === LogsQueryResultStatus.PartialFailure
          ? result.partialError?.message
          : undefined,
      statistics: result.statistics
    };
  } catch (err) {
    console.error("❌ Azure Log Analytics Query Error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("az login") || msg.includes("CredentialUnavailableError") || msg.includes("DefaultAzureCredential")) {
      throw new Error("Azure Authentication Failed: Please run 'az login' in your terminal OR configure AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET in .env OR set VITE_REQUIRE_AZURE_AD_AUTH=true in .env to login via Azure AD.");
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
