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

export async function clearCacheApi(token?: string): Promise<{ success: boolean; message: string; clearedCount: number; user: string }> {
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return requestJson<{ success: boolean; message: string; clearedCount: number; user: string }>("/api/cache/clear", {
    method: "POST",
    headers
  });
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
  subscriptionId?: string;
  subscriptionName?: string;
  resourceGroup?: string;
};

export async function fetchUserWorkspaces(accessToken: string): Promise<AzureWorkspace[]> {
  const url = "https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01";
  
  // Join Resources with ResourceContainers to resolve human-readable subscription names across all subscriptions
  const query = `
    Resources
    | where type =~ 'microsoft.operationalinsights/workspaces'
    | project id, name, customerId = tostring(properties.customerId), subscriptionId, resourceGroup
    | join kind=leftouter (
        ResourceContainers
        | where type =~ 'microsoft.resources/subscriptions'
        | project subscriptionId, subscriptionName = name
    ) on subscriptionId
    | project id, name, customerId, subscriptionId, subscriptionName = coalesce(subscriptionName, subscriptionId), resourceGroup
  `;

  try {
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
          $top: 500
        }
      })
    });

    const data = await response.json();
    if (response.ok && data.data && Array.isArray(data.data)) {
      return data.data.map((row: any) => ({
        id: row.id || row[0],
        name: row.name || row[1],
        customerId: row.customerId || row[2],
        subscriptionId: row.subscriptionId || row[3] || undefined,
        subscriptionName: row.subscriptionName || row[4] || undefined,
        resourceGroup: row.resourceGroup || row[5] || undefined
      }));
    }
  } catch (e) {
    console.warn("Resource Graph query with subscriptions failed, falling back to basic query:", e);
  }

  // Fallback to simpler query if ResourceContainers join failed
  const fallbackQuery = `
    Resources
    | where type =~ 'microsoft.operationalinsights/workspaces'
    | project id, name, customerId = tostring(properties.customerId), subscriptionId, resourceGroup
  `;

  const fallbackResponse = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: fallbackQuery,
      options: {
        $skip: 0,
        $top: 500
      }
    })
  });

  const fallbackData = await fallbackResponse.json();
  if (!fallbackResponse.ok) {
    throw new Error(fallbackData.error?.message || "Failed to fetch workspaces from Azure.");
  }

  return (fallbackData.data || []).map((row: any) => ({
    id: row.id || row[0],
    name: row.name || row[1],
    customerId: row.customerId || row[2],
    subscriptionId: row.subscriptionId || row[3] || undefined,
    subscriptionName: row.subscriptionId || row[3] || undefined,
    resourceGroup: row.resourceGroup || row[4] || undefined
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
