import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { THEMES, type ThemeMode } from "../../constants/themes";

export interface GraphicalThemeSelectProps {
  currentTheme: ThemeMode;
  onSelectTheme: (t: ThemeMode) => void;
}

export function GraphicalThemeSelect({
  currentTheme,
  onSelectTheme
}: GraphicalThemeSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const activeThemeConfig = THEMES.find((t) => t.id === currentTheme) || THEMES[0];

  return (
    <div ref={containerRef} style={{ position: "relative", zIndex: isOpen ? 10006 : 10 }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "auto",
          minWidth: "150px",
          height: "36px",
          padding: "5px 12px",
          background: "var(--glass-surface-elevated)",
          border: `1px solid ${isOpen ? "var(--color-accent-action)" : "var(--glass-border)"}`,
          borderTop: "1px solid var(--glass-border-luminous)",
          borderRadius: "8px",
          color: "var(--color-text-primary)",
          fontSize: "12px",
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          cursor: "pointer",
          boxShadow: isOpen ? "0 0 0 2px rgba(111, 123, 96, 0.2)" : "var(--glass-shadow)",
          transition: "all 0.15s ease"
        }}
        title="Change application color theme"
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden" }}>
          <span style={{ fontSize: "14px" }}>{activeThemeConfig.icon}</span>
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: 700 }}>
            {activeThemeConfig.name}
          </span>
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: activeThemeConfig.accent,
              boxShadow: `0 0 6px ${activeThemeConfig.accent}80`,
              flexShrink: 0
            }}
          />
        </div>
        <ChevronDown
          size={13}
          color="var(--color-text-secondary)"
          style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease", flexShrink: 0 }}
        />
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            left: "auto",
            minWidth: "330px",
            zIndex: 99999,
            backgroundColor: "var(--color-surface)",
            background: "var(--glass-popover-bg, var(--color-surface))",
            backdropFilter: "var(--glass-popover-blur)",
            WebkitBackdropFilter: "var(--glass-popover-blur)",
            border: "1px solid var(--glass-border)",
            borderTop: "1px solid var(--glass-border-luminous)",
            borderRadius: "12px",
            boxShadow: "var(--glass-popover-shadow)",
            padding: "8px",
            maxHeight: "420px",
            display: "flex",
            flexDirection: "column",
            gap: "5px",
            animation: "modalFadeIn 0.12s ease-out"
          }}
        >
          <div style={{ padding: "4px 8px 6px 8px", borderBottom: "1px solid var(--glass-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              🎨 Select UI Theme ({THEMES.length})
            </span>
          </div>

          <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
            {THEMES.map((th) => {
              const isSelected = th.id === currentTheme;
              return (
                <div
                  key={th.id}
                  onClick={() => {
                    onSelectTheme(th.id);
                    setIsOpen(false);
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = "var(--glass-surface-hover)";
                      e.currentTarget.style.borderColor = "var(--glass-border-focus)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = "var(--glass-surface)";
                      e.currentTarget.style.borderColor = "transparent";
                    }
                  }}
                  style={{
                    padding: "8px 10px",
                    borderRadius: "8px",
                    background: isSelected ? "rgba(111, 123, 96, 0.22)" : "var(--glass-surface)",
                    border: `1px solid ${isSelected ? th.accent : "transparent"}`,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "10px",
                    transition: "all 0.12s ease"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: "16px", flexShrink: 0 }}>{th.icon}</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px", overflow: "hidden" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                          {th.name}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: "3px", marginLeft: "4px" }}>
                          <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: th.primaryBg, border: "1px solid rgba(255,255,255,0.2)" }} />
                          <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: th.surfaceBg, border: "1px solid rgba(255,255,255,0.2)" }} />
                          <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: th.accent }} />
                        </div>
                      </div>
                      <span style={{ fontSize: "10px", color: "var(--color-text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {th.description}
                      </span>
                    </div>
                  </div>

                  {isSelected && (
                    <span style={{ fontSize: "11px", color: th.accent, fontWeight: 700, background: `${th.accent}20`, padding: "2px 6px", borderRadius: "4px", flexShrink: 0 }}>
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
