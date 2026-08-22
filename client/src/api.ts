import type { ParsedFilter, QueryResponse } from "./types";

export type BackendHealthResponse = {
  ok: boolean;
  azureWorkspaceConfigured?: boolean;
  workspaceOverrideEnabled?: boolean;
  port?: number;
  timestamp?: string;
  error?: string;
};

export async function checkBackendHealth(): Promise<BackendHealthResponse> {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status} ${response.statusText}`
      };
    }
    const data = await response.json();
    return {
      ok: Boolean(data.ok),
      azureWorkspaceConfigured: Boolean(data.azureWorkspaceConfigured),
      workspaceOverrideEnabled: Boolean(data.workspaceOverrideEnabled),
      port: data.port,
      timestamp: data.timestamp
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || "Unable to connect to backend server"
    };
  }
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {})
      }
    });
  } catch (err: any) {
    throw new Error(`Request failed: Backend API endpoint '${url}' is unreachable. Please verify backend application status (npm run dev).`);
  }

  const text = await response.text();
  let data: any = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text || `HTTP ${response.status} ${response.statusText}` };
  }

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status} ${response.statusText}`);
  }

  return data as T;
}

export async function parseQuery(query: string): Promise<ParsedFilter[]> {
  const response = await requestJson<{ filters: ParsedFilter[] }>("/api/parse", {
    method: "POST",
    body: JSON.stringify({ query })
  });

  return response.filters;
}

export async function runQuery(args: {
  query: string;
  timespan: string;
  workspaceId?: string;
  filters: Array<{ id: string; enabled: boolean }>;
  maxRows?: number;
  token?: string;
}): Promise<QueryResponse> {
  const headers: Record<string, string> = {};
  if (args.token) {
    headers["Authorization"] = `Bearer ${args.token}`;
  }

  return requestJson<QueryResponse>("/api/query", {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: args.query,
      timespan: args.timespan,
      workspaceId: args.workspaceId,
      filters: args.filters,
      maxRows: args.maxRows
    })
  });
}

export async function sendChatMessage(messages: { role: "system" | "user" | "assistant", content: string }[]): Promise<string> {
  const response = await requestJson<{ answer: string }>("/api/chat", {
    method: "POST",
    body: JSON.stringify({ messages })
  });
  return response.answer;
}

export type AzureWorkspace = {
  id: string;
  name: string;
  customerId: string; // The UUID used for Log Analytics querying
};

export async function fetchUserWorkspaces(accessToken: string): Promise<AzureWorkspace[]> {
  const url = "https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01";
  
  const query = `
    Resources
    | where type =~ 'microsoft.operationalinsights/workspaces'
    | project id, name, customerId = properties.customerId
  `;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query,
      options: {
        $skip: 0,
        $top: 100
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "Failed to fetch workspaces from Azure.");
  }

  return (data.data || []).map((row: any) => ({
    id: row.id || row[0],
    name: row.name || row[1],
    customerId: row.customerId || row[2]
  }));
}

export async function fetchServerWorkspaces(): Promise<AzureWorkspace[]> {
  try {
    const res = await fetch("/api/workspaces");
    if (!res.ok) return [];
    const data = await res.json();
    return data.workspaces || [];
  } catch {
    return [];
  }
}
