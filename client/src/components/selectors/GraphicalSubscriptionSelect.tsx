import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export interface GraphicalSubscriptionSelectProps {
  subscriptions: Array<{ id?: string; name: string; count: number }>;
  selectedSubscription: string;
  totalWorkspacesCount: number;
  onSelect: (sub: string) => void;
}

export function GraphicalSubscriptionSelect({
  subscriptions,
  selectedSubscription,
  totalWorkspacesCount,
  onSelect
}: GraphicalSubscriptionSelectProps) {
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

  const currentSub = subscriptions.find((s) => s.name === selectedSubscription || s.id === selectedSubscription);
  const displayText = selectedSubscription === "ALL" || !currentSub
    ? `All Subscriptions (${subscriptions.length})`
    : currentSub.name;

  const filtered = useMemo(() => {
    if (!search.trim()) return subscriptions;
    const q = search.toLowerCase();
    return subscriptions.filter(
      (s) => s.name.toLowerCase().includes(q) || (s.id && s.id.toLowerCase().includes(q))
    );
  }, [subscriptions, search]);

  return (
    <div ref={containerRef} style={{ position: "relative", minWidth: "160px", zIndex: isOpen ? 10005 : 1 }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title="Filter workspaces by Azure Subscription"
        style={{
          width: "auto",
          minWidth: "170px",
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
          <span style={{ fontSize: "13px" }}>💳</span>
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: 700 }}>
            {displayText}
          </span>
        </div>
        <ChevronDown
          size={13}
          color="#6F7B60"
          style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease", flexShrink: 0 }}
        />
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            minWidth: "260px",
            zIndex: 99999,
            background: "var(--glass-popover-bg)",
            backdropFilter: "var(--glass-popover-blur)",
            WebkitBackdropFilter: "var(--glass-popover-blur)",
            border: "1px solid var(--glass-border)",
            borderRadius: "10px",
            boxShadow: "var(--glass-popover-shadow)",
            padding: "8px",
            maxHeight: "320px",
            display: "flex",
            flexDirection: "column",
            gap: "6px"
          }}
        >
          {subscriptions.length > 4 && (
            <div style={{ padding: "2px 4px" }}>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="🔍 Search subscriptions..."
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
            {/* All Subscriptions Option */}
            <div
              onClick={() => {
                onSelect("ALL");
                setIsOpen(false);
              }}
              style={{
                padding: "8px 10px",
                borderRadius: "6px",
                background: selectedSubscription === "ALL"
                  ? "rgba(111, 123, 96, 0.14)"
                  : "var(--glass-surface)",
                border: `1px solid ${selectedSubscription === "ALL" ? "#6F7B60" : "transparent"}`,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                transition: "background-color 0.1s ease"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "13px" }}>🌐</span>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                    All Subscriptions
                  </span>
                  <span style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>
                    Show workspaces across all subscriptions
                  </span>
                </div>
              </div>
              <span style={{ fontSize: "11px", color: "var(--color-accent-action)", fontWeight: 700, background: "rgba(111, 123, 96, 0.18)", padding: "2px 6px", borderRadius: "4px" }}>
                {totalWorkspacesCount} ws
              </span>
            </div>

            {/* Individual Subscriptions */}
            {filtered.map((sub) => {
              const isSelected = selectedSubscription === sub.name || (sub.id && selectedSubscription === sub.id);
              return (
                <div
                  key={sub.name}
                  onClick={() => {
                    onSelect(sub.name);
                    setIsOpen(false);
                  }}
                  style={{
                    padding: "8px 10px",
                    borderRadius: "6px",
                    background: isSelected
                      ? "rgba(111, 123, 96, 0.14)"
                      : "var(--glass-surface)",
                    border: `1px solid ${isSelected ? "var(--color-accent-action)" : "transparent"}`,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    transition: "background-color 0.1s ease"
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", overflow: "hidden" }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      📁 {sub.name}
                    </span>
                    {sub.id && sub.id !== sub.name && (
                      <span style={{ fontSize: "10px", color: "var(--color-text-muted)", fontFamily: "monospace" }}>
                        Sub ID: {sub.id.substring(0, 13)}...
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: "11px", color: isSelected ? "var(--color-accent-action)" : "var(--color-text-secondary)", fontWeight: 600, background: "rgba(164, 173, 140, 0.18)", padding: "2px 6px", borderRadius: "4px", flexShrink: 0 }}>
                    {sub.count} {sub.count === 1 ? "ws" : "ws"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
