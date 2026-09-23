import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { PresetQuery } from "../../types";

export interface GraphicalPresetSelectProps {
  presets: PresetQuery[];
  activePreset: PresetQuery | null;
  presetColors: Record<string, { bg: string; text: string }>;
  onSelect: (preset: PresetQuery) => void;
}

export function GraphicalPresetSelect({
  presets,
  activePreset,
  presetColors,
  onSelect
}: GraphicalPresetSelectProps) {
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

  const filteredPresets = useMemo(() => {
    if (!search.trim()) return presets;
    const term = search.toLowerCase();
    return presets.filter(
      (p) => p.name.toLowerCase().includes(term)
    );
  }, [presets, search]);

  const activeColor = activePreset ? presetColors[activePreset.id]?.bg || "#6F7B60" : "#6F7B60";

  return (
    <div ref={containerRef} style={{ position: "relative", minWidth: "190px", zIndex: isOpen ? 10005 : 1 }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "auto",
          minWidth: "190px",
          maxWidth: "300px",
          height: "34px",
          padding: "5px 12px",
          background: "var(--glass-surface)",
          border: `1px solid ${isOpen ? activeColor : "var(--glass-border)"}`,
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
          <span style={{ fontSize: "13px" }}>⚡</span>
          <span style={{ fontWeight: 700, color: activePreset ? activeColor : "var(--color-text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {activePreset ? activePreset.name : "-- Select a Log Preset --"}
          </span>
        </div>
        <ChevronDown size={13} color="#6F7B60" style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease", flexShrink: 0 }} />
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            left: "auto",
            minWidth: "280px",
            zIndex: 99999,
            background: "var(--glass-popover-bg)",
            backdropFilter: "var(--glass-popover-blur)",
            WebkitBackdropFilter: "var(--glass-popover-blur)",
            border: "1px solid var(--glass-border)",
            borderRadius: "10px",
            boxShadow: "var(--glass-popover-shadow)",
            padding: "8px",
            maxHeight: "340px",
            display: "flex",
            flexDirection: "column",
            gap: "8px"
          }}
        >
          <div style={{ padding: "2px 4px" }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 Search preset name..."
              style={{
                width: "100%",
                padding: "7px 10px",
                fontSize: "12px",
                background: "var(--glass-surface-elevated)",
                border: "1px solid var(--glass-border)",
                borderRadius: "6px",
                color: "var(--color-text-primary)",
                outline: "none"
              }}
            />
          </div>

          <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
            {filteredPresets.map((preset) => {
              const isSelected = activePreset?.id === preset.id;
              const colorInfo = presetColors[preset.id] || { bg: "#6F7B60", text: "#FEFCFF" };

              return (
                <div
                  key={preset.id}
                  onClick={() => {
                    onSelect(preset);
                    setIsOpen(false);
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: isSelected
                      ? "rgba(111, 123, 96, 0.14)"
                      : "var(--glass-surface)",
                    border: `1px solid ${isSelected ? colorInfo.bg : "transparent"}`,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    transition: "background-color 0.1s ease"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", overflow: "hidden" }}>
                    <span
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        backgroundColor: colorInfo.bg,
                        flexShrink: 0
                      }}
                    />
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {preset.name}
                    </span>
                  </div>

                  {isSelected && (
                    <span style={{ fontSize: "11px", color: colorInfo.bg, fontWeight: 700, background: `${colorInfo.bg}15`, padding: "2px 6px", borderRadius: "4px", flexShrink: 0 }}>
                      ✓ Active
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
