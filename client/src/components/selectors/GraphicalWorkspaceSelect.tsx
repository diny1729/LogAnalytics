import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { AzureWorkspace } from "../../api";

export interface GraphicalWorkspaceSelectProps {
  workspaces: AzureWorkspace[];
  workspaceId: string;
  selectedSubscription?: string;
  onSelect: (id: string) => void;
  onManualClick: () => void;
}

export function GraphicalWorkspaceSelect({
  workspaces,
  workspaceId,
  selectedSubscription = "ALL",
  onSelect,
  onManualClick
}: GraphicalWorkspaceSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedWs = workspaces.find((w) => w.customerId === workspaceId);

  const subscriptionWorkspaces = useMemo(() => {
    if (!selectedSubscription || selectedSubscription === "ALL") return workspaces;
    return workspaces.filter(
      (w) => w.subscriptionName === selectedSubscription || w.subscriptionId === selectedSubscription
    );
  }, [workspaces, selectedSubscription]);

  const filteredWorkspaces = useMemo(() => {
    if (!search.trim()) return subscriptionWorkspaces;
    const term = search.toLowerCase();
    return subscriptionWorkspaces.filter(
      (w) =>
        w.name.toLowerCase().includes(term) ||
        w.customerId.toLowerCase().includes(term) ||
        (w.subscriptionName && w.subscriptionName.toLowerCase().includes(term))
    );
  }, [subscriptionWorkspaces, search]);

  return (
    <div ref={containerRef} style={{ position: "relative", minWidth: "200px", zIndex: isOpen ? 10005 : 1 }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "auto",
          minWidth: "210px",
          maxWidth: "340px",
          height: "34px",
          padding: "5px 12px",
          background: "var(--glass-surface)",
          border: `1px solid ${isOpen ? "#6F7B60" : "var(--glass-border)"}`,
          borderRadius: "6px",
          color: "var(--color-text-primary)",
          fontSize: "12px",
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          cursor: "pointer",
          boxShadow: isOpen ? "0 0 0 2px rgba(111, 123, 96, 0.15)" : "0 1px 2px rgba(44, 51, 46, 0.04)",
          transition: "background-color 0.12s ease, border-color 0.12s ease"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden" }}>
          <span style={{ fontSize: "13px" }}>🏢</span>
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: 700 }}>
            {selectedWs ? `${selectedWs.name} (${selectedWs.customerId.slice(0, 8)}...)` : `-- Select a Workspace (${subscriptionWorkspaces.length}) --`}
          </span>
        </div>
        <ChevronDown size={13} color="#6F7B60" style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease", flexShrink: 0 }} />
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            minWidth: "300px",
            zIndex: 99999,
            background: "var(--glass-popover-bg)",
            backdropFilter: "var(--glass-popover-blur)",
            WebkitBackdropFilter: "var(--glass-popover-blur)",
            border: "1px solid var(--glass-border)",
            borderRadius: "10px",
            boxShadow: "var(--glass-popover-shadow)",
            padding: "8px",
            maxHeight: "300px",
            display: "flex",
            flexDirection: "column",
            gap: "6px"
          }}
        >
          {subscriptionWorkspaces.length > 5 && (
            <div style={{ padding: "2px 4px" }}>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="🔍 Search workspaces..."
                style={{
                  width: "100%",
                  padding: "6px 10px",
                  fontSize: "12px",
                  background: "var(--glass-surface-elevated)",
                  border: "1px solid var(--glass-border)",
                  borderRadius: "6px",
                  color: "var(--color-text-primary)",
                  outline: "none"
                }}
              />
            </div>
          )}

          <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
            {filteredWorkspaces.map((ws) => {
              const isSelected = ws.customerId === workspaceId;
              return (
                <div
                  key={ws.customerId}
                  onClick={() => {
                    onSelect(ws.customerId);
                    setIsOpen(false);
                  }}
                  style={{
                    padding: "8px 10px",
                    borderRadius: "6px",
                    background: isSelected
                      ? "rgba(111, 123, 96, 0.14)"
                      : "var(--glass-surface)",
                    border: `1px solid ${isSelected ? "#6F7B60" : "transparent"}`,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    transition: "background-color 0.1s ease"
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden" }}>
                      <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        🏢 {ws.name}
                      </span>
                      {ws.subscriptionName && (
                        <span style={{ fontSize: "10px", color: "var(--color-text-secondary)", background: "rgba(111, 123, 96, 0.18)", border: "1px solid var(--glass-border)", padding: "1px 5px", borderRadius: "4px", whiteSpace: "nowrap" }}>
                          {ws.subscriptionName}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: "10px", color: "var(--color-text-muted)", fontFamily: "monospace" }}>
                      {ws.customerId}
                    </span>
                  </div>
                  {isSelected && (
                    <span style={{ fontSize: "11px", color: "var(--color-accent-action)", fontWeight: 700, background: "rgba(111, 123, 96, 0.18)", padding: "2px 6px", borderRadius: "4px", flexShrink: 0 }}>
                      ✓ Selected
                    </span>
                  )}
                </div>
              );
            })}

            {filteredWorkspaces.length === 0 && (
              <div style={{ padding: "12px", textAlign: "center", color: "var(--color-text-muted)", fontSize: "12px" }}>
                No workspaces found matching filter.
              </div>
            )}

            <div
              onClick={() => {
                onManualClick();
                setIsOpen(false);
              }}
              style={{
                padding: "8px 10px",
                borderRadius: "6px",
                background: "rgba(111, 123, 96, 0.12)",
                border: "1px dashed rgba(142, 155, 137, 0.5)",
                cursor: "pointer",
                fontSize: "12px",
                color: "var(--color-text-primary)",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}
            >
              <span>✏️</span>
              <span>Enter Custom Workspace ID Manually...</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
