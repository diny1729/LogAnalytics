import { useState } from "react";
import { ChevronDown, ChevronUp, Columns3, Search } from "lucide-react";
import type { PresetQuery } from "../../types";

export interface ProjectColumnsDropdownProps {
  activePreset: PresetQuery;
  presetProjectColumns: Set<string>;
  isOpen: boolean;
  onToggleOpen: () => void;
  onToggleColumn: (col: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

export function ProjectColumnsDropdown({
  activePreset,
  presetProjectColumns,
  isOpen,
  onToggleOpen,
  onToggleColumn,
  onSelectAll,
  onClearAll
}: ProjectColumnsDropdownProps) {
  const [dropdownSearch, setDropdownSearch] = useState("");

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
          background: presetProjectColumns.size > 0 ? "rgba(111, 123, 96, 0.18)" : "var(--glass-surface)",
          border: `1px solid ${presetProjectColumns.size > 0 ? "var(--color-accent-action)" : "var(--glass-border)"}`,
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
        <Columns3 size={15} color="#6F7B60" />
        <span>Project Columns ({presetProjectColumns.size} / {activePreset.projectColumns.length})</span>
        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {isOpen && (
        <div className="multiselect-dropdown-menu" onClick={(e) => e.stopPropagation()}>
          <div className="dropdown-search-box">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              placeholder="Search columns..."
              value={dropdownSearch}
              onChange={(e) => setDropdownSearch(e.target.value)}
            />
            {dropdownSearch && (
              <button type="button" className="clear-btn" onClick={() => setDropdownSearch("")}>✕</button>
            )}
          </div>
          <div className="dropdown-actions">
            <button type="button" onClick={onSelectAll}>Select All</button>
            <button type="button" onClick={onClearAll}>Deselect All</button>
          </div>
          <div className="dropdown-list" style={{ maxHeight: "320px" }}>
            {activePreset.projectColumns
              .filter(col => !dropdownSearch || col.toLowerCase().includes(dropdownSearch.toLowerCase()))
              .map((col) => {
                const checked = presetProjectColumns.has(col);
                return (
                  <div
                    key={col}
                    className={`dropdown-item ${checked ? "is-selected" : ""}`}
                    onClick={() => onToggleColumn(col)}
                    style={{ flexShrink: 0, minHeight: "32px", display: "flex", alignItems: "center", gap: "8px" }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {}}
                      style={{ flexShrink: 0 }}
                    />
                    <span style={{ color: checked ? "var(--color-text-primary)" : "var(--color-accent-action)", fontSize: "12px", fontWeight: checked ? 700 : 500 }}>{col}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
