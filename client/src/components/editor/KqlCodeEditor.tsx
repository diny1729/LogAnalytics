import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Play } from "lucide-react";
import type { PresetQuery } from "../../types";
import { BASE_KQL_SUGGESTIONS } from "../../constants/kql";
import { validateKql } from "../../utils/kqlUtils";

export interface KqlCodeEditorProps {
  query: string;
  onChange: (newQuery: string) => void;
  onRun: (e?: number | React.MouseEvent) => void;
  loading: boolean;
  isRunDisabled?: boolean;
  activePreset?: PresetQuery | null;
  tableColumns?: string[];
  dynamicFilterValues?: Record<string, string[]>;
}

export function KqlCodeEditor({
  query,
  onChange,
  onRun,
  loading,
  isRunDisabled = false,
  activePreset,
  tableColumns = [],
  dynamicFilterValues = {}
}: KqlCodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [cursorPos, setCursorPos] = useState<number>(0);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [searchPrefix, setSearchPrefix] = useState<string>("");
  const [prefixStart, setPrefixStart] = useState<number>(0);
  const suggestionsListRef = useRef<HTMLDivElement | null>(null);

  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number } | null>(null);

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const currentX = dragOffset?.x ?? 0;
    const currentY = dragOffset?.y ?? 0;
    dragStartPos.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: currentX,
      startY: currentY
    };
  };

  useEffect(() => {
    let rafId: number | null = null;
    function handleMouseMove(e: MouseEvent) {
      if (!isDragging || !dragStartPos.current) return;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!dragStartPos.current) return;
        const dx = e.clientX - dragStartPos.current.mouseX;
        const dy = e.clientY - dragStartPos.current.mouseY;
        setDragOffset({
          x: dragStartPos.current.startX + dx,
          y: dragStartPos.current.startY + dy
        });
      });
    }

    function handleMouseUp() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      setIsDragging(false);
      dragStartPos.current = null;
    }

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove, { passive: true });
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  const syntaxErrors = useMemo(() => validateKql(query), [query]);

  const availableColumns = useMemo(() => {
    const set = new Set<string>();

    if (activePreset) {
      if (activePreset.projectColumns) {
        activePreset.projectColumns.forEach((c) => set.add(c));
      }
      if (activePreset.options) {
        activePreset.options.forEach((opt) => {
          const fieldMatch = opt.clause.match(/\|\s*where\s+([^\s=!<]+)/i);
          if (fieldMatch) set.add(fieldMatch[1]);
        });
      }
      if (activePreset.dynamicFilters) {
        activePreset.dynamicFilters.forEach((df) => set.add(df.field));
      }
    }

    tableColumns.forEach((c) => set.add(c));

    const activeCode = query
      .split("\n")
      .map((line) => line.split("//")[0])
      .join("\n");

    const projectMatches = [...activeCode.matchAll(/\|\s*project\s+([^|]+)/gi)];
    projectMatches.forEach((m) => {
      m[1].split(",").forEach((col) => {
        const name = col.trim().split("=")[0].trim();
        if (name) set.add(name);
      });
    });

    const extendMatches = [...activeCode.matchAll(/\|\s*extend\s+([a-zA-Z0-9_]+)\s*=/gi)];
    extendMatches.forEach((m) => {
      if (m[1]) set.add(m[1].trim());
    });

    const summarizeMatches = [...activeCode.matchAll(/\|\s*summarize\s+([^|]+)/gi)];
    summarizeMatches.forEach((m) => {
      const clause = m[1];
      const bySplit = clause.split(/\bby\b/i);
      bySplit.forEach((part) => {
        part.split(",").forEach((col) => {
          const name = col.trim().split("=")[0].trim();
          if (name && !name.includes("(")) set.add(name);
        });
      });
    });

    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [activePreset, tableColumns, query]);

  const allSuggestions = useMemo(() => {
    const list: { label: string; detail: string; type: "command" | "function" | "operator" | "keyword" | "table" | "column" }[] = [];

    availableColumns.forEach((col) => {
      list.push({
        label: col,
        detail: `Column name (${activePreset?.name || "Query"})`,
        type: "column"
      });
    });

    BASE_KQL_SUGGESTIONS.forEach((item) => list.push(item));

    return list;
  }, [availableColumns, activePreset]);

  const operatorContextSuggestions = useMemo(() => {
    const textBeforeCursor = query.slice(0, cursorPos);
    const opMatch = textBeforeCursor.match(/\|\s*where\s+([a-zA-Z0-9_]+)\s*(==|!=|contains|!contains|between|!between|>|<|>=|<=|has|!has|has_any|has_all|startswith|!startswith|endswith|!endswith|in|!in|in~|!in~)\s*([a-zA-Z0-9_"'()]*)$/i);
    const targetCol = opMatch ? opMatch[1] : null;
    const operator = opMatch ? opMatch[2].toLowerCase() : null;

    const list: { label: string; detail: string; type: "command" | "function" | "operator" | "keyword" | "table" | "column" }[] = [];

    if (targetCol && dynamicFilterValues && dynamicFilterValues[targetCol]) {
      dynamicFilterValues[targetCol].slice(0, 15).forEach((val) => {
        const formattedVal = /^\d+$/.test(val) ? val : `"${val}"`;
        list.push({
          label: formattedVal,
          detail: `Value for ${targetCol}`,
          type: "keyword"
        });
      });
    }

    if (operator === "between" || operator === "!between") {
      list.push(
        { label: "(400 .. 599)", detail: "HTTP Error status range (400 .. 599)", type: "keyword" },
        { label: "(200 .. 299)", detail: "HTTP Success status range (200 .. 299)", type: "keyword" },
        { label: "(ago(24h) .. ago(1h))", detail: "Time range last 24h to 1h ago", type: "function" },
        { label: "(ago(7d) .. ago(24h))", detail: "Time range 7 days to 24h ago", type: "function" },
        { label: "400 .. 599", detail: "Status code range", type: "keyword" },
        { label: "200 .. 299", detail: "Status code range", type: "keyword" }
      );
    } else if (operator === "in" || operator === "!in" || operator === "in~" || operator === "!in~") {
      list.push(
        { label: "( 502,403,404,504 )", detail: "HTTP Error status codes set", type: "keyword" },
        { label: "( 200,201,204 )", detail: "HTTP Success status codes set", type: "keyword" },
        { label: "( '400','500' )", detail: "String status codes set", type: "keyword" },
        { label: "( 400,401,403,404,500,502,503,504 )", detail: "Comprehensive HTTP error codes set", type: "keyword" }
      );
      if (targetCol && dynamicFilterValues && dynamicFilterValues[targetCol]) {
        const topVals = dynamicFilterValues[targetCol].slice(0, 5);
        if (topVals.length > 0) {
          const formatted = topVals.map(v => /^\d+$/.test(v) ? v : `"${v}"`).join(", ");
          list.push({
            label: `( ${formatted} )`,
            detail: `Distinct values set for ${targetCol}`,
            type: "keyword"
          });
        }
      }
    } else if (operator === "has" || operator === "!has" || operator === "has_any" || operator === "has_all") {
      list.push(
        { label: "('400','500')", detail: "HTTP status terms set ('400','500')", type: "keyword" },
        { label: "( 502,403,404,504 )", detail: "HTTP status code set", type: "keyword" },
        { label: "'400'", detail: "Term '400'", type: "keyword" },
        { label: "'500'", detail: "Term '500'", type: "keyword" },
        { label: "'502'", detail: "Term '502'", type: "keyword" },
        { label: "'403'", detail: "Term '403'", type: "keyword" },
        { label: "'404'", detail: "Term '404'", type: "keyword" }
      );
    } else {
      list.push(
        { label: "ago(15m)", detail: "15 minutes ago relative timestamp", type: "function" },
        { label: "ago(1h)", detail: "1 hour ago relative timestamp", type: "function" },
        { label: "ago(24h)", detail: "24 hours ago relative timestamp", type: "function" },
        { label: "ago(7d)", detail: "7 days ago relative timestamp", type: "function" },
        { label: "ago(30d)", detail: "30 days ago relative timestamp", type: "function" },
        { label: "true", detail: "Boolean true", type: "keyword" },
        { label: "false", detail: "Boolean false", type: "keyword" },
        { label: "null", detail: "Null value check", type: "keyword" },
        { label: "tostring()", detail: "Convert expression to string", type: "function" },
        { label: "toint()", detail: "Convert expression to integer", type: "function" }
      );
    }

    return list;
  }, [query, cursorPos, dynamicFilterValues]);

  const columnContextSuggestions = useMemo(() => {
    const textBeforeCursor = query.slice(0, cursorPos);
    const colMatch = textBeforeCursor.match(/(?:\|\s*where|\bwhere)\s+([a-zA-Z0-9_]+)\s*$/i);
    if (colMatch) {
      const colName = colMatch[1];
      return [
        { label: "==", detail: `Equals condition for ${colName}`, type: "operator" as const },
        { label: "!=", detail: `Not equals condition for ${colName}`, type: "operator" as const },
        { label: `between (400 .. 599)`, detail: `Range filter between (400 .. 599) for ${colName}`, type: "operator" as const },
        { label: `!in ( 502,403,404,504 )`, detail: `Exclude set !in (502, 403, 404, 504) for ${colName}`, type: "operator" as const },
        { label: `in ( 502,403,404,504 )`, detail: `Filter set in (502, 403, 404, 504) for ${colName}`, type: "operator" as const },
        { label: `has ('400','500')`, detail: `Filter terms has ('400','500') for ${colName}`, type: "operator" as const },
        { label: `!has ('400','500')`, detail: `Exclude terms !has ('400','500') for ${colName}`, type: "operator" as const },
        { label: "between", detail: `Range condition for ${colName}`, type: "operator" as const },
        { label: "in", detail: `In set condition for ${colName}`, type: "operator" as const },
        { label: "!in", detail: `Not in set condition for ${colName}`, type: "operator" as const },
        { label: "has", detail: `Term match for ${colName}`, type: "operator" as const },
        { label: "!has", detail: `Exclude term match for ${colName}`, type: "operator" as const },
        { label: "contains", detail: `Substring match for ${colName}`, type: "operator" as const },
        { label: "!contains", detail: `Does not contain match for ${colName}`, type: "operator" as const },
        { label: ">", detail: `Greater than condition for ${colName}`, type: "operator" as const },
        { label: "<", detail: `Less than condition for ${colName}`, type: "operator" as const },
        { label: ">=", detail: `Greater than or equal for ${colName}`, type: "operator" as const },
        { label: "<=", detail: `Less than or equal for ${colName}`, type: "operator" as const },
        { label: "has_any", detail: `Match any term in set for ${colName}`, type: "operator" as const },
        { label: "has_all", detail: `Match all terms in set for ${colName}`, type: "operator" as const },
        { label: "startswith", detail: `Prefix match for ${colName}`, type: "operator" as const },
        { label: "endswith", detail: `Suffix match for ${colName}`, type: "operator" as const }
      ];
    }
    return [];
  }, [query, cursorPos]);

  const matchingSuggestions = useMemo(() => {
    const combined = [...columnContextSuggestions, ...operatorContextSuggestions, ...allSuggestions];
    
    const map = new Map<string, typeof combined[0]>();
    combined.forEach(item => {
      if (!map.has(item.label)) {
        map.set(item.label, item);
      }
    });
    const uniqueList = Array.from(map.values());

    if (!searchPrefix || searchPrefix.length < 1) {
      return uniqueList.slice(0, 30);
    }
    const term = searchPrefix.toLowerCase();
    return uniqueList.filter((item) => item.label.toLowerCase().includes(term));
  }, [searchPrefix, allSuggestions, operatorContextSuggestions, columnContextSuggestions]);

  function updatePrefix(newQuery: string, pos: number) {
    const textBeforeCursor = newQuery.slice(0, pos);

    const match = textBeforeCursor.match(/([a-zA-Z0-9_"]+)$/);
    if (match) {
      setSearchPrefix(match[1]);
      setPrefixStart(pos - match[1].length);
      setShowSuggestions(true);
      setSelectedIndex(0);
      return;
    }

    const opMatch = textBeforeCursor.match(/(==|!=|contains|!contains|between|!between|>|<|>=|<=|has|!has|has_any|has_all|startswith|!startswith|endswith|!endswith|in|!in|in~|!in~)\s*$/i);
    if (opMatch) {
      setSearchPrefix("");
      setPrefixStart(pos);
      setShowSuggestions(true);
      setSelectedIndex(0);
      return;
    }

    const colSpaceMatch = textBeforeCursor.match(/(?:\|\s*where|\bwhere)\s+([a-zA-Z0-9_]+)\s*$/i);
    if (colSpaceMatch) {
      setSearchPrefix("");
      setPrefixStart(pos);
      setShowSuggestions(true);
      setSelectedIndex(0);
      return;
    }

    const pipeMatch = textBeforeCursor.match(/\|\s*$/);
    if (pipeMatch) {
      setSearchPrefix("");
      setPrefixStart(pos);
      setShowSuggestions(true);
      setSelectedIndex(0);
      return;
    }

    const whereMatch = textBeforeCursor.match(/\bwhere\s+$/i);
    if (whereMatch) {
      setSearchPrefix("");
      setPrefixStart(pos);
      setShowSuggestions(true);
      setSelectedIndex(0);
      return;
    }

    setShowSuggestions(false);
  }

  function handleSelectSuggestion(suggestion: { label: string }) {
    const insertion = suggestion.label;
    const before = query.slice(0, prefixStart);
    const after = query.slice(cursorPos);
    const updated = before + insertion + " " + after;
    onChange(updated);
    setShowSuggestions(false);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newPos = prefixStart + insertion.length + 1;
        textareaRef.current.setSelectionRange(newPos, newPos);
      }
    }, 0);
  }

  useEffect(() => {
    if (showSuggestions && suggestionsListRef.current) {
      const container = suggestionsListRef.current;
      const activeEl = container.children[selectedIndex] as HTMLElement | undefined;
      if (activeEl && typeof activeEl.scrollIntoView === "function") {
        activeEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex, showSuggestions]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showSuggestions && matchingSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => (prev + 1) % matchingSuggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => (prev - 1 + matchingSuggestions.length) % matchingSuggestions.length);
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const selected = matchingSuggestions[selectedIndex] || matchingSuggestions[0];
        if (selected) {
          handleSelectSuggestion(selected);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setShowSuggestions(false);
        return;
      }
    }
    if (e.ctrlKey && e.key === " ") {
      e.preventDefault();
      const pos = textareaRef.current?.selectionStart || 0;
      updatePrefix(query, pos);
      setShowSuggestions(true);
    }
  }

  const [editorSize, setEditorSize] = useState<"normal" | "minimized" | "expanded">("normal");

  useEffect(() => {
    if (loading) {
      setEditorSize("minimized");
    }
  }, [loading]);

  const handleRunClick = (e?: React.MouseEvent) => {
    setEditorSize("minimized");
    onRun(e);
  };
  const lines = query.split("\n");

  return (
    <div style={{ position: "relative", zIndex: 1 }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 14px",
        background: syntaxErrors.length > 0 ? "rgba(254, 235, 238, 0.95)" : "var(--table-header-bg)",
        border: `1px solid ${syntaxErrors.length > 0 ? "rgba(178, 58, 72, 0.5)" : "var(--glass-border)"}`,
        borderBottom: editorSize === "minimized" ? undefined : "none",
        borderTopLeftRadius: "8px",
        borderTopRightRadius: "8px",
        borderBottomLeftRadius: editorSize === "minimized" ? "8px" : 0,
        borderBottomRightRadius: editorSize === "minimized" ? "8px" : 0,
        fontSize: "12px",
        color: "var(--color-text-primary)"
      }}>
        <span style={{ fontWeight: 600, color: syntaxErrors.length > 0 ? "var(--glass-danger)" : "var(--color-text-primary)", display: "flex", alignItems: "center", gap: "6px" }}>
          <span>KQL Code Editor</span>
          <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>({lines.length} lines)</span>
          {syntaxErrors.length > 0 && (
            <span style={{ color: "var(--glass-danger)", fontSize: "11px", fontWeight: 600, background: "rgba(178, 58, 72, 0.12)", padding: "2px 6px", borderRadius: "4px" }}>
              ⚠️ {syntaxErrors.length} Syntax {syntaxErrors.length === 1 ? "Error" : "Errors"}
            </span>
          )}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            onClick={() => setEditorSize(editorSize === "minimized" ? "normal" : "minimized")}
            style={{
              background: editorSize === "minimized" ? "rgba(111, 123, 96, 0.15)" : "var(--glass-surface-elevated)",
              border: `1px solid ${editorSize === "minimized" ? "var(--color-accent-action)" : "var(--glass-border)"}`,
              color: editorSize === "minimized" ? "var(--color-accent-action)" : "var(--color-text-primary)",
              borderRadius: "6px",
              padding: "4px 8px",
              fontSize: "11px",
              fontWeight: 500,
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              cursor: "pointer",
              transition: "background-color 0.12s ease"
            }}
            title={editorSize === "minimized" ? "Expand KQL Editor" : "Minimize KQL Editor"}
          >
            {editorSize === "minimized" ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            <span>{editorSize === "minimized" ? "Expand" : "Minimize"}</span>
          </button>
          <button
            type="button"
            onClick={() => setEditorSize(editorSize === "expanded" ? "normal" : "expanded")}
            style={{
              background: editorSize === "expanded" ? "rgba(111, 123, 96, 0.15)" : "var(--glass-surface-elevated)",
              border: `1px solid ${editorSize === "expanded" ? "var(--color-accent-action)" : "var(--glass-border)"}`,
              color: editorSize === "expanded" ? "var(--color-accent-action)" : "var(--color-text-primary)",
              borderRadius: "6px",
              padding: "4px 8px",
              fontSize: "11px",
              fontWeight: 500,
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              cursor: "pointer",
              transition: "background-color 0.12s ease"
            }}
            title={editorSize === "expanded" ? "Standard Height" : "Full Height Editor"}
          >
            <span>{editorSize === "expanded" ? "Standard Height" : "Full Height"}</span>
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleRunClick}
            disabled={loading || isRunDisabled}
            title={isRunDisabled ? "Please select at least 1 Dynamic Filter option to run query" : "Run Query"}
            style={{
              fontSize: "12px",
              fontWeight: 500,
              padding: "4px 12px",
              height: "28px",
              minWidth: "max-content",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: isRunDisabled ? "rgba(111, 123, 96, 0.15)" : undefined,
              color: isRunDisabled ? "var(--color-text-muted)" : undefined,
              borderColor: isRunDisabled ? "rgba(164, 173, 140, 0.3)" : undefined,
              cursor: isRunDisabled ? "not-allowed" : "pointer",
              opacity: isRunDisabled ? 0.7 : 1
            }}
          >
            <Play size={14} />
            <span>{loading ? "Running..." : "Run Query"}</span>
          </button>
        </div>
      </div>

      {editorSize === "minimized" ? (
        <div
          onClick={() => setEditorSize("normal")}
          style={{
            padding: "10px 14px",
            background: "var(--glass-surface-elevated)",
            border: "1px solid var(--glass-border)",
            borderBottomLeftRadius: "8px",
            borderBottomRightRadius: "8px",
            fontSize: "12px",
            color: "var(--color-text-primary)",
            fontFamily: "monospace",
            cursor: "pointer",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
          title="Click to expand editor"
        >
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <span style={{ color: "var(--color-accent-action)", fontWeight: 600 }}>Minimized Editor: </span>
            <span>{query.replace(/\n/g, " | ")}</span>
          </div>
          <span style={{ fontSize: "11px", color: "var(--color-accent-action)", fontWeight: 500, marginLeft: "12px", flexShrink: 0 }}>
            Click to expand ▾
          </span>
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          <textarea
            ref={textareaRef}
            className="query-editor"
            style={{
              borderTopLeftRadius: 0,
              borderTopRightRadius: 0,
              borderColor: syntaxErrors.length > 0 ? "rgba(244, 63, 94, 0.5)" : undefined,
              boxShadow: syntaxErrors.length > 0 ? "0 0 10px rgba(244, 63, 94, 0.2)" : undefined,
              height: editorSize === "expanded" ? "420px" : "140px"
            }}
            value={query}
            onChange={(e) => {
              const val = e.target.value;
              const pos = e.target.selectionStart;
              setCursorPos(pos);
              onChange(val);
              updatePrefix(val, pos);
            }}
            onClick={(e) => {
              const pos = (e.target as HTMLTextAreaElement).selectionStart;
              setCursorPos(pos);
              updatePrefix(query, pos);
            }}
            onKeyUp={(e) => {
              if (showSuggestions && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Tab")) {
                return;
              }
              if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
                const pos = (e.target as HTMLTextAreaElement).selectionStart;
                setCursorPos(pos);
                updatePrefix(query, pos);
              }
            }}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            placeholder="Enter KQL query here..."
          />

          {showSuggestions && matchingSuggestions.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: dragOffset ? undefined : "10px",
                right: dragOffset ? undefined : "16px",
                transform: dragOffset ? `translate(${dragOffset.x}px, ${dragOffset.y}px)` : undefined,
                width: "360px",
                maxWidth: "calc(100% - 32px)",
                maxHeight: "260px",
                background: "var(--glass-popover-bg)",
                backdropFilter: "var(--glass-popover-blur)",
                WebkitBackdropFilter: "var(--glass-popover-blur)",
                border: "1px solid var(--glass-border)",
                borderRadius: "8px",
                boxShadow: "var(--glass-popover-shadow)",
                zIndex: 3000,
                padding: "4px",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column"
              }}
            >
            <div
              onMouseDown={handleHeaderMouseDown}
              style={{
                padding: "6px 10px",
                fontSize: "11px",
                color: "#38bdf8",
                background: "rgba(24, 86, 255, 0.18)",
                borderBottom: "1px solid var(--glass-border)",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: isDragging ? "grabbing" : "grab",
                userSelect: "none"
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span>⋮⋮ KQL Suggestions ({matchingSuggestions.length})</span>
                <span style={{ fontSize: "10px", color: "#94a3b8", fontWeight: 400 }}>(Drag to move anywhere)</span>
              </span>
              <span style={{ fontSize: "10px", color: "#94a3b8" }}>Tab / Enter to select</span>
            </div>
            <div ref={suggestionsListRef} style={{ maxHeight: "200px", overflowY: "auto", padding: "4px" }}>
              {matchingSuggestions.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                const typeIcon =
                  item.type === "column" ? "📊" :
                  item.type === "command" ? "🔑" :
                  item.type === "function" ? "⚡" :
                  item.type === "table" ? "📋" : "⚙️";

                const typeColor =
                  item.type === "column" ? "#38bdf8" :
                  item.type === "command" ? "#60a5fa" :
                  item.type === "function" ? "#fbbf24" :
                  item.type === "table" ? "#a78bfa" : "#94a3b8";

                return (
                  <div
                    key={`${item.label}-${idx}`}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "4px",
                      background: isSelected ? "rgba(24, 86, 255, 0.25)" : "transparent",
                      color: isSelected ? "#ffffff" : "#f8fafc",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: "12px",
                      margin: "2px 0"
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectSuggestion(item);
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden" }}>
                      <span style={{ fontSize: "12px" }}>{typeIcon}</span>
                      <span style={{ fontWeight: 700, color: typeColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {item.label}
                      </span>
                    </div>
                    <span style={{ fontSize: "10px", color: "#94a3b8", marginLeft: "10px", whiteSpace: "nowrap" }}>
                      {item.detail}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      )}

      {syntaxErrors.length > 0 && (
        <div style={{
          marginTop: "6px",
          padding: "8px 12px",
          background: "rgba(244, 63, 94, 0.12)",
          border: "1px solid rgba(244, 63, 94, 0.4)",
          borderRadius: "6px",
          display: "flex",
          flexDirection: "column",
          gap: "4px"
        }}>
          {syntaxErrors.map((err, idx) => (
            <div key={idx} style={{ fontSize: "12px", color: "#fecdd3", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ color: "#f43f5e", fontWeight: 700, minWidth: "max-content" }}>⚠️ Line {err.line}:</span>
              <span>{err.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
