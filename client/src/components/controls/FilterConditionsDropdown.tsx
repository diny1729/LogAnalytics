import { useState } from "react";
import { ChevronDown, ChevronUp, Search, SlidersHorizontal } from "lucide-react";
import type { PresetOption, PresetQuery } from "../../types";
import { buildOptionClause } from "../../utils/filterUtils";

export interface FilterConditionsDropdownProps {
  activePreset: PresetQuery;
  presetOptions: Set<string>;
  optionOperators: Record<string, string>;
  optionValues: Record<string, string>;
  isOpen: boolean;
  onToggleOpen: () => void;
  onToggleOption: (opt: PresetOption) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onOperatorChange: (opt: PresetOption, newOp: string) => void;
  onValueChange: (opt: PresetOption, newVal: string) => void;
}

export function FilterConditionsDropdown({
  activePreset,
  presetOptions,
  optionOperators,
  optionValues,
  isOpen,
  onToggleOpen,
  onToggleOption,
  onSelectAll,
  onClearAll,
  onOperatorChange,
  onValueChange
}: FilterConditionsDropdownProps) {
  const [dropdownSearch, setDropdownSearch] = useState("");
  const [hoveredCondition, setHoveredCondition] = useState<PresetOption | null>(null);

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className="modal-trigger-btn"
        onClick={(e) => {
          e.stopPropagation();
          onToggleOpen();
          setDropdownSearch("");
        }}
        style={{
          background: presetOptions.size > 0 ? "rgba(111, 123, 96, 0.18)" : "var(--glass-surface)",
          border: `1px solid ${presetOptions.size > 0 ? "var(--color-accent-action)" : "var(--glass-border)"}`,
          color: "var(--color-text-primary)",
          padding: "8px 14px",
          borderRadius: "8px",
          fontSize: "13px",
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          cursor: "pointer",
          transition: "all 0.12s ease"
        }}
      >
        <SlidersHorizontal size={15} color="#6F7B60" />
        <span>Filter Conditions ({presetOptions.size} / {activePreset.options.length})</span>
        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {isOpen && (
        <div className="multiselect-dropdown-menu wide-dropdown" onClick={(e) => e.stopPropagation()}>
          <div className="dropdown-search-box">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              placeholder="Search conditions..."
              value={dropdownSearch}
              onChange={(e) => setDropdownSearch(e.target.value)}
            />
            {dropdownSearch && (
              <button type="button" className="clear-btn" onClick={() => setDropdownSearch("")}>✕</button>
            )}
          </div>
          <div className="dropdown-actions" style={{ justifyContent: "space-between", gap: "8px" }}>
            <div style={{ display: "flex", gap: "8px" }}>
              <button type="button" onClick={onSelectAll}>Select All</button>
              <button type="button" onClick={onClearAll}>Deselect All</button>
            </div>
            <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Operators: ==, !=, contains, !contains, between</span>
          </div>
          <div className="dropdown-list" style={{ maxHeight: "320px" }}>
            {activePreset.options
              .filter(opt => !dropdownSearch || opt.label.toLowerCase().includes(dropdownSearch.toLowerCase()))
              .map((opt) => {
                const checked = presetOptions.has(opt.label) || presetOptions.has(opt.clause);
                const defaultOp = opt.clause.includes("!contains")
                  ? "!contains"
                  : opt.clause.includes("contains")
                  ? "contains"
                  : opt.clause.includes("!in")
                  ? "!in"
                  : opt.clause.includes("in")
                  ? "in"
                  : opt.clause.includes("!has")
                  ? "!has"
                  : opt.clause.includes("has")
                  ? "has"
                  : opt.clause.includes("between")
                  ? "between"
                  : opt.clause.includes("!=")
                  ? "!="
                  : "==";
                const currentOp = optionOperators[opt.label] || defaultOp;
                const defaultVal = opt.clause.includes("between")
                  ? (opt.clause.match(/between\s*\(([^)]+)\)/i)?.[1] ?? "400 .. 599")
                  : opt.clause.match(/\b(!?in)\s*\(([^)]+)\)/i)
                  ? (opt.clause.match(/\b(!?in)\s*\(([^)]+)\)/i)?.[2] ?? "502,403,404,504")
                  : opt.clause.match(/\b(!?has)\s*\(([^)]+)\)/i)
                  ? (opt.clause.match(/\b(!?has)\s*\(([^)]+)\)/i)?.[2] ?? "'400','500'")
                  : (opt.clause.match(/"([^"]*)"/)?.[1] ?? "");
                const currentVal = optionValues[opt.label] !== undefined ? optionValues[opt.label] : defaultVal;

                return (
                  <div
                    key={opt.label}
                    className={`dropdown-item ${checked ? "is-selected" : ""}`}
                    onMouseEnter={() => setHoveredCondition(opt)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleOption(opt);
                    }}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexShrink: 0, minHeight: "36px" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "0 0 240px", minWidth: "180px", overflow: "hidden" }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {}}
                        style={{ flexShrink: 0 }}
                      />
                      <span style={{ fontWeight: checked ? 700 : 500, fontSize: "12px", color: checked ? "var(--color-text-primary)" : "var(--color-accent-action)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={opt.label}>
                        {opt.label}
                      </span>
                    </div>

                    <div
                      style={{ display: "flex", alignItems: "center", gap: "8px", flex: "1 1 auto", minWidth: "0" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <select
                        value={currentOp}
                        onChange={(e) => onOperatorChange(opt, e.target.value)}
                        style={{
                          background: "var(--glass-surface)",
                          border: "1px solid var(--glass-border)",
                          borderRadius: "4px",
                          color: "var(--color-accent-action)",
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "3px 6px",
                          outline: "none",
                          cursor: "pointer",
                          flexShrink: 0
                        }}
                      >
                        <option value="==">==</option>
                        <option value="!=">!=</option>
                        <option value="contains">contains</option>
                        <option value="!contains">!contains</option>
                        <option value="<">&lt;</option>
                        <option value="<=">&lt;=</option>
                        <option value=">">&gt;</option>
                        <option value=">=">&gt;=</option>
                        <option value="between">between</option>
                        <option value="in">in</option>
                        <option value="!in">!in</option>
                        <option value="has">has</option>
                        <option value="!has">!has</option>
                      </select>

                      <input
                        type="text"
                        value={currentVal}
                        onChange={(e) => onValueChange(opt, e.target.value)}
                        placeholder={
                          currentOp === "between"
                            ? "400 .. 599"
                            : currentOp === "in" || currentOp === "!in"
                            ? "502,403,404,504"
                            : currentOp === "has" || currentOp === "!has"
                            ? "'400','500'"
                            : "value..."
                        }
                        style={{
                          flex: "1",
                          minWidth: "120px",
                          background: "var(--glass-surface)",
                          border: "1px solid var(--glass-border)",
                          borderRadius: "4px",
                          color: "var(--color-text-primary)",
                          fontSize: "11px",
                          padding: "4px 8px",
                          outline: "none"
                        }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>

          {hoveredCondition && (
            <div style={{
              padding: "6px 12px",
              background: "var(--glass-surface-elevated)",
              borderTop: "1px solid var(--glass-border)",
              fontSize: "11px",
              color: "var(--color-accent-action)",
              fontFamily: "var(--font-mono)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              flexShrink: 0
            }}>
              <span style={{ fontWeight: 600 }}>⚡ KQL Preview: </span>
              <span>
                {buildOptionClause(hoveredCondition, optionOperators[hoveredCondition.label], optionValues[hoveredCondition.label])}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
