import { useState } from "react";

export interface QueryWarningAlertProps {
  partialError: string;
  query: string;
  timespan: string;
  maxRows: number;
  workspaceId: string;
}

export function QueryWarningAlert({
  partialError,
  query,
  timespan,
  maxRows,
  workspaceId
}: QueryWarningAlertProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="alert warning" style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
          <span style={{ fontSize: "16px", marginTop: "2px" }}>⚠️</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: "14px", color: "#fde68a" }}>
              Query Execution Warning / Truncation
            </div>
            <div style={{ fontSize: "13px", color: "#fef3c7", marginTop: "2px" }}>
              {partialError || "There were some errors or partial data truncation when processing your query."}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          style={{
            background: "rgba(217, 119, 6, 0.3)",
            border: "1px solid rgba(251, 191, 36, 0.4)",
            color: "#fde68a",
            borderRadius: "6px",
            padding: "4px 10px",
            fontSize: "11px",
            fontWeight: 700,
            cursor: "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0
          }}
        >
          {showDetails ? "Hide Error Details ▲" : "View Error Details ▾"}
        </button>
      </div>

      {showDetails && (
        <div
          style={{
            background: "rgba(0, 0, 0, 0.45)",
            border: "1px solid rgba(251, 191, 36, 0.3)",
            borderRadius: "6px",
            padding: "12px",
            fontSize: "12px",
            color: "#cbd5e1",
            fontFamily: "monospace",
            display: "flex",
            flexDirection: "column",
            gap: "8px"
          }}
        >
          <div><strong style={{ color: "#fde68a" }}>Workspace ID:</strong> {workspaceId || "Default Workspace"}</div>
          <div><strong style={{ color: "#fde68a" }}>Timespan Requested:</strong> {timespan}</div>
          <div><strong style={{ color: "#fde68a" }}>Max Rows:</strong> {maxRows}</div>
          <div>
            <strong style={{ color: "#fde68a" }}>Executed KQL Query:</strong>
            <pre style={{ margin: "4px 0 0 0", padding: "8px", background: "rgba(15, 23, 42, 0.8)", borderRadius: "4px", color: "#38bdf8", overflowX: "auto" }}>
              {query}
            </pre>
          </div>
          <div>
            <strong style={{ color: "#fde68a" }}>Azure Warning Details:</strong>
            <div style={{ color: "#fda4af", marginTop: "2px" }}>{partialError}</div>
          </div>
        </div>
      )}
    </div>
  );
}
