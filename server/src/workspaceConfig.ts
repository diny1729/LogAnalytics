export interface WorkspaceEntry {
  id: string;
  name: string;
  customerId: string;
  subscriptionId?: string;
  subscriptionName?: string;
}

export function parseWorkspaceEntries(envWorkspaces: string): WorkspaceEntry[] {
  const list: WorkspaceEntry[] = [];

  if (!envWorkspaces || !envWorkspaces.trim()) {
    return list;
  }

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
        wsName = `Workspace (${customerId.substring(0, 8)}...)`;
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

  return list;
}
