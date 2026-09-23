import type { AzureWorkspace } from "../api";
import type { TabState } from "../types";
import { starterQuery, CUSTOM_PRESET } from "../constants/presets";
import { getEnv } from "../env";

export function getPredefinedWorkspaces(): AzureWorkspace[] {
  const envWorkspaces = getEnv("VITE_WORKSPACES");
  const list: AzureWorkspace[] = [];
  
  if (envWorkspaces.trim()) {
    envWorkspaces.split(",").forEach((entry: string) => {
      const trimmed = entry.trim();
      if (!trimmed) return;

      let subName: string | undefined;
      let wsName = "";
      let customerId = "";

      // Check format: SubscriptionName/WorkspaceName:CustomerId
      if (trimmed.includes("/") && trimmed.includes(":")) {
        const slashIdx = trimmed.indexOf("/");
        subName = trimmed.substring(0, slashIdx).trim();
        const remainder = trimmed.substring(slashIdx + 1).trim();
        const colonIdx = remainder.lastIndexOf(":");
        if (colonIdx !== -1) {
          wsName = remainder.substring(0, colonIdx).trim();
          customerId = remainder.substring(colonIdx + 1).trim();
        }
      } else {
        const parts = trimmed.split(":");
        if (parts.length >= 3) {
          // Format: SubscriptionName:WorkspaceName:CustomerId
          subName = parts[0].trim();
          wsName = parts[1].trim();
          customerId = parts.slice(2).join(":").trim();
        } else if (parts.length === 2) {
          // Format: WorkspaceName:CustomerId
          wsName = parts[0].trim();
          customerId = parts[1].trim();
        } else {
          // Format: CustomerId
          customerId = trimmed;
          wsName = `Predefined (${customerId.substring(0, 8)}...)`;
        }
      }

      if (customerId) {
        list.push({
          id: customerId,
          name: wsName || customerId,
          customerId,
          subscriptionName: subName || "Default Subscription",
          subscriptionId: subName || undefined
        });
      }
    });
  }

  const defaultWs = getEnv("VITE_LOG_ANALYTICS_WORKSPACE_ID");
  if (defaultWs && defaultWs.trim() && !list.some(w => w.customerId === defaultWs.trim())) {
    list.unshift({
      id: defaultWs.trim(),
      name: "Default Workspace (.env)",
      customerId: defaultWs.trim(),
      subscriptionName: "Default Subscription"
    });
  }

  return list;
}

export function combineWorkspaces(fetched: AzureWorkspace[]): AzureWorkspace[] {
  const predefined = getPredefinedWorkspaces();
  const map = new Map<string, AzureWorkspace>();

  fetched.forEach(w => {
    if (w.customerId) map.set(w.customerId, w);
  });
  predefined.forEach(w => {
    if (w.customerId && !map.has(w.customerId)) {
      map.set(w.customerId, w);
    } else if (w.customerId && map.has(w.customerId)) {
      const existing = map.get(w.customerId)!;
      if (!existing.subscriptionName && w.subscriptionName) {
        existing.subscriptionName = w.subscriptionName;
        existing.subscriptionId = w.subscriptionId;
      }
    }
  });

  return Array.from(map.values());
}

export function createInitialTab(id: string, title?: string, initialWsId: string = "", initialSub: string = "ALL"): TabState {
  return {
    id,
    title: title || "Query 1",
    query: starterQuery,
    timespan: "PT24H",
    maxRows: 1000,
    workspaceId: initialWsId,
    selectedSubscription: initialSub,
    result: null,
    loading: false,
    error: null,
    activePreset: CUSTOM_PRESET,
    presetOptions: new Set(),
    presetProjectColumns: new Set(),
    dynamicFilterValues: {},
    selectedDynamicFilters: {},
    filterSearch: {},
    optionOperators: {},
    optionValues: {},
    customStart: "",
    customEnd: "",
    isCustomInputMode: false
  };
}
