import { ChevronDown, ChevronUp, Search, SlidersHorizontal } from "lucide-react";

export interface DynamicFilterItem {
  label: string;
  field: string;
  clauseTemplate: (val: string | string[]) => string;
}

export interface DynamicFiltersBarProps {
  dynamicFilters: DynamicFilterItem[];
  dynamicFilterValues: Record<string, string[]>;
  selectedDynamicFilters: Record<string, string[]>;
  filterSearch: Record<string, string>;
  openDynamicField: string | null;
  totalActiveDynamicFilters: number;
  activeDynamicFieldRef: React.RefObject<HTMLDivElement | null>;
  onToggleField: (field: string) => void;
  onSearchChange: (field: string, val: string) => void;
  onSelectAll: (field: string, values: string[]) => void;
  onClearAll: (field: string) => void;
  onToggleValue: (field: string, val: string) => void;
}

export function DynamicFiltersBar({
  dynamicFilters,
  dynamicFilterValues,
  selectedDynamicFilters,
  filterSearch,
  openDynamicField,
  totalActiveDynamicFilters,
  activeDynamicFieldRef,
  onToggleField,
  onSearchChange,
  onSelectAll,
  onClearAll,
  onToggleValue
}: DynamicFiltersBarProps) {
  if (!dynamicFilters || dynamicFilters.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px", backgroundColor: "var(--glass-surface)", borderRadius: "10px", border: "1px solid var(--glass-border)", marginBottom: "16px", position: "relative", zIndex: openDynamicField ? 9999 : 5 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--color-text-primary)", display: "flex", alignItems: "center", gap: "6px" }}>
          <SlidersHorizontal size={16} color="#6F7B60" />
          <span>Dynamic Filters (Optional):</span>
        </span>
        {totalActiveDynamicFilters > 0 ? (
          <span style={{ fontSize: "12px", color: "#6F7B60", fontWeight: 600 }}>
            ✓ {totalActiveDynamicFilters} filter {totalActiveDynamicFilters === 1 ? "value" : "values"} active
          </span>
        ) : (
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)", fontWeight: 500 }}>
            Optional (Click any filter below to refine results)
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", position: "relative", zIndex: openDynamicField ? 9999 : 5 }}>
        {dynamicFilters.map((filter) => {
          const rawValues = dynamicFilterValues[filter.field] || [];
          const sortedValues = [...rawValues].sort((a, b) =>
             a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
          );
          const searchTerm = (filterSearch[filter.field] || "").trim().toLowerCase();
          const matchingValues = searchTerm
            ? sortedValues.filter((val) => val.toLowerCase().includes(searchTerm))
            : sortedValues;
          const selectedVals = selectedDynamicFilters[filter.field] || [];
          const isOpen = openDynamicField === filter.field;
          const hasSelection = selectedVals.length > 0;

          return (
            <div
              key={filter.field}
              ref={isOpen ? activeDynamicFieldRef : null}
              style={{ position: "relative", zIndex: isOpen ? 10000 : 1 }}
            >
              <button
                type="button"
                className="modal-trigger-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleField(filter.field);
                }}
                style={{
                  background: hasSelection ? "rgba(111, 123, 96, 0.18)" : "var(--glass-surface)",
                  border: `1px solid ${hasSelection ? "var(--color-accent-action)" : "var(--glass-border)"}`,
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
                <SlidersHorizontal size={15} color={hasSelection ? "var(--color-accent-action)" : "var(--color-text-muted)"} />
                <span>
                  {filter.label}{" "}
                  {hasSelection ? (
                    <strong style={{ color: "var(--color-text-primary)" }}>({selectedVals.length} selected)</strong>
                  ) : (
                    <span style={{ color: "var(--color-text-muted)" }}>(0 selected)</span>
                  )}
                </span>
                {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {isOpen && (
                <div
                  className="multiselect-dropdown-menu wide-dropdown"
                  style={{
                    width: "420px",
                    maxWidth: "90vw",
                    left: 0,
                    top: "calc(100% + 8px)",
                    zIndex: 10001
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--glass-border)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--glass-surface-elevated)" }}>
                    <span style={{ fontWeight: 700, fontSize: "13px", color: "var(--color-text-primary)" }}>
                      {filter.label}
                    </span>
                    <button
                      type="button"
                      className="clear-btn"
                      onClick={() => onToggleField(filter.field)}
                      style={{ fontSize: "14px", color: "var(--color-text-muted)", background: "none", border: "none", cursor: "pointer" }}
                    >
                      ✕
                    </button>
                  </div>

                  <div className="dynamic-filter-inputs" style={{ padding: "12px" }}>
                    <div className="filter-search-box">
                      <Search size={14} className="filter-search-icon" />
                      <input
                        type="text"
                        className="filter-search-field"
                        placeholder={`Search ${filter.label}...`}
                        value={filterSearch[filter.field] || ""}
                        onChange={(e) => onSearchChange(filter.field, e.target.value)}
                      />
                      {filterSearch[filter.field] && (
                        <button
                          type="button"
                          className="clear-search-btn"
                          onClick={() => onSearchChange(filter.field, "")}
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div className="dynamic-filter-actions" style={{ margin: "8px 0" }}>
                      <button
                        type="button"
                        className="filter-action-btn"
                        onClick={() => onSelectAll(filter.field, matchingValues)}
                        disabled={matchingValues.length === 0}
                      >
                        Select All ({matchingValues.length})
                      </button>
                      <button
                        type="button"
                        className="filter-action-btn clear"
                        onClick={() => onClearAll(filter.field)}
                        disabled={selectedVals.length === 0}
                      >
                        Deselect All
                      </button>
                    </div>

                    <div className="dynamic-filter-options-list" style={{ maxHeight: "180px" }}>
                      {matchingValues.length === 0 ? (
                        <div className="dynamic-filter-empty">No matching values found</div>
                      ) : (
                        matchingValues.map((val) => {
                          const isSelected = selectedVals.includes(val);
                          return (
                            <label
                              key={val}
                              className={`dynamic-filter-option-item ${isSelected ? "selected" : ""}`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => onToggleValue(filter.field, val)}
                              />
                              <span className="option-text" title={val}>{val}</span>
                            </label>
                          );
                        })
                      )}
                    </div>

                    {selectedVals.length > 0 && (
                      <div className="selected-chips-container" style={{ marginTop: "10px" }}>
                        {selectedVals.map((val) => (
                          <span key={val} className="selected-chip" title={val}>
                            <span className="chip-text">{val}</span>
                            <button
                              type="button"
                              className="chip-remove"
                              onClick={() => onToggleValue(filter.field, val)}
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
