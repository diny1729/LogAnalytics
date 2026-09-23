import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Columns3,
  Download,
  Filter,
  Search,
  SlidersHorizontal
} from "lucide-react";
import type { QueryTable, FilterOperator } from "../../types";
import { formatCell, toCsv } from "../../utils/formatUtils";
import { getRelatedColumns, evaluateFilterCondition, matchesValueOperator } from "../../utils/filterUtils";

export interface ResultTableProps {
  table: QueryTable;
  query?: string;
  presetProjectColumns?: Set<string>;
  workspaceId?: string;
}

function getPageNumbers(currentPage: number, totalPages: number): (number | "...")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const page1Indexed = currentPage + 1;
  if (page1Indexed <= 4) {
    return [1, 2, 3, 4, 5, "...", totalPages];
  }
  if (page1Indexed >= totalPages - 3) {
    return [1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, "...", page1Indexed - 1, page1Indexed, page1Indexed + 1, "...", totalPages];
}

export function ResultTable({
  table,
  query = "",
  presetProjectColumns,
  workspaceId
}: ResultTableProps) {
  const [search, setSearch] = useState("");
  const [sortColumnName, setSortColumnName] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc" | null>(null);
  const [useLocalTime, setUseLocalTime] = useState(true);
  const [page, setPage] = useState(0);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizingCol, setResizingCol] = useState<{ name: string; startX: number; startWidth: number } | null>(null);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);

  const [globalWrapText, setGlobalWrapText] = useState(false);
  const [wrappedColumns, setWrappedColumns] = useState<Set<string>>(new Set());
  const [wrappedRows, setWrappedRows] = useState<Set<number>>(new Set());

  function toggleColumnWrap(colName: string) {
    setWrappedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(colName)) next.delete(colName);
      else next.add(colName);
      return next;
    });
  }

  function toggleRowWrap(rowIndex: number) {
    setWrappedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }

  // Custom column order state (allows moving columns left/right & drag/drop)
  const [columnOrder, setColumnOrder] = useState<string[]>(() =>
    table.columns.map((c) => c.name)
  );

  // Sync state when table schema changes
  useEffect(() => {
    setColumnOrder(table.columns.map((c) => c.name));
    setSortColumnName(null);
    setSortDirection(null);
    setPage(0);
  }, [table]);

  const [visibleColumns, setVisibleColumns] = useState<string[]>(() =>
    getRelatedColumns(query, table.columns.map((c) => c.name), presetProjectColumns)
  );

  useEffect(() => {
    const related = getRelatedColumns(query, table.columns.map((c) => c.name), presetProjectColumns);
    setVisibleColumns(related);
  }, [table, query, presetProjectColumns]);

  const [pageSize, setPageSize] = useState<number>(50);

  // Filtered and ordered visible columns
  const orderedVisibleColumns = useMemo(() => {
    return columnOrder.filter((colName) => visibleColumns.includes(colName));
  }, [columnOrder, visibleColumns]);

  function handleDragEnd() {
    setDraggedColumn(null);
  }

  function getDefaultColumnWidth(colName: string): number {
    if (/requesturi/i.test(colName)) {
      return 450; // 3x standard default width (150px * 3)
    }
    return 150;
  }

  // Column resizing
  function handleResizeStart(e: React.MouseEvent, columnName: string, currentWidth: number) {
    e.stopPropagation();
    e.preventDefault();
    setResizingCol({ name: columnName, startX: e.clientX, startWidth: currentWidth || getDefaultColumnWidth(columnName) });
  }

  useEffect(() => {
    if (!resizingCol) return;
    let rafId: number | null = null;

    function handleMouseMove(e: MouseEvent) {
      if (!resizingCol) return;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!resizingCol) return;
        const { startX, startWidth, name } = resizingCol;
        const diff = e.clientX - startX;
        const newWidth = Math.max(70, startWidth + diff);
        setColumnWidths((prev) => ({ ...prev, [name]: newWidth }));
      });
    }

    function handleMouseUp() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      setResizingCol(null);
    }

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizingCol]);

  // Drag and drop reordering
  function handleDragStart(e: React.DragEvent, colName: string) {
    setDraggedColumn(colName);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: React.DragEvent, targetColName: string) {
    e.preventDefault();
    if (!draggedColumn || draggedColumn === targetColName) return;

    setColumnOrder((prev) => {
      const fromIdx = prev.indexOf(draggedColumn);
      const toIdx = prev.indexOf(targetColName);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const updated = [...prev];
      const [removed] = updated.splice(fromIdx, 1);
      updated.splice(toIdx, 0, removed);
      return updated;
    });
    setDraggedColumn(null);
  }

  // Column header sorting
  function handleSort(colName: string) {
    if (sortColumnName === colName) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else if (sortDirection === "desc") {
        setSortColumnName(null);
        setSortDirection(null);
      }
    } else {
      setSortColumnName(colName);
      setSortDirection("asc");
    }
  }

  // Output Value Filters State
  const [selectedValueFilters, setSelectedValueFilters] = useState<Record<string, Set<string>>>({});
  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null);
  const [flyoutSearch, setFlyoutSearch] = useState("");
  const [isValueFilterOpen, setIsValueFilterOpen] = useState(false);
  const valueFilterRef = useRef<HTMLDivElement | null>(null);

  // Column filter operators state: ==, !=, contains, !contains, <, <=, >, >=
  const [columnFilterOperators, setColumnFilterOperators] = useState<Record<string, FilterOperator>>({});

  // Summary table states
  const [summaryScope, setSummaryScope] = useState<"filtered" | "all">("filtered");
  const [summarySelectedColumns, setSummarySelectedColumns] = useState<Set<string>>(new Set());
  const [summarySelectedSubValues, setSummarySelectedSubValues] = useState<Record<string, Set<string>>>({});
  const [draftSummaryColumns, setDraftSummaryColumns] = useState<Set<string>>(new Set());
  const [draftSummarySubValues, setDraftSummarySubValues] = useState<Record<string, Set<string>>>({});

  const [summarySortColumn, setSummarySortColumn] = useState<string | null>(null);
  const [summarySortDirection, setSummarySortDirection] = useState<"asc" | "desc" | null>(null);
  const [isSummaryDropdownOpen, setIsSummaryDropdownOpen] = useState(false);
  const [summaryHoveredCol, setSummaryHoveredCol] = useState<string | null>(null);
  const summaryDropdownRef = useRef<HTMLDivElement | null>(null);

  // Summary table column width & resizing states
  const [summaryColumnWidths, setSummaryColumnWidths] = useState<Record<string, number>>({});
  const [summaryResizingCol, setSummaryResizingCol] = useState<{ name: string; startX: number; startWidth: number } | null>(null);
  const [summaryPage, setSummaryPage] = useState<number>(0);
  const [summaryPageSize, setSummaryPageSize] = useState<number>(50);
  const [summaryWrappedCols, setSummaryWrappedCols] = useState<Set<string>>(new Set());

  function getDefaultSummaryColumnWidth(colKey: string): number {
    if (/requesturi|url|path|uri/i.test(colKey) || colKey === "Distinct Output Value") {
      return 380;
    }
    if (colKey === "Count") return 110;
    if (colKey === "% Share") return 150;
    if (/ip|host/i.test(colKey)) return 180;
    return 190;
  }

  function handleSummaryResizeStart(e: React.MouseEvent, colName: string, currentWidth: number) {
    e.stopPropagation();
    e.preventDefault();
    setSummaryResizingCol({
      name: colName,
      startX: e.clientX,
      startWidth: currentWidth || getDefaultSummaryColumnWidth(colName)
    });
  }

  useEffect(() => {
    if (!summaryResizingCol) return;
    let rafId: number | null = null;

    function handleMouseMove(e: MouseEvent) {
      if (!summaryResizingCol) return;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!summaryResizingCol) return;
        const { startX, startWidth, name } = summaryResizingCol;
        const diff = e.clientX - startX;
        const newWidth = Math.max(70, startWidth + diff);
        setSummaryColumnWidths((prev) => ({ ...prev, [name]: newWidth }));
      });
    }

    function handleMouseUp() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      setSummaryResizingCol(null);
    }

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [summaryResizingCol]);

  function toggleSummaryColWrap(colKey: string) {
    setSummaryWrappedCols((prev) => {
      const next = new Set(prev);
      if (next.has(colKey)) next.delete(colKey);
      else next.add(colKey);
      return next;
    });
  }

  const isSummaryDropdownOpenRef = useRef(isSummaryDropdownOpen);
  isSummaryDropdownOpenRef.current = isSummaryDropdownOpen;
  const draftColsRef = useRef(draftSummaryColumns);
  draftColsRef.current = draftSummaryColumns;
  const draftSubRef = useRef(draftSummarySubValues);
  draftSubRef.current = draftSummarySubValues;
  const summarySelectedColumnsRef = useRef(summarySelectedColumns);
  summarySelectedColumnsRef.current = summarySelectedColumns;
  const summarySelectedSubValuesRef = useRef(summarySelectedSubValues);
  summarySelectedSubValuesRef.current = summarySelectedSubValues;

  const commitSummaryDraft = () => {
    const draftCols = draftColsRef.current;
    const draftSub = draftSubRef.current;
    const currentCols = summarySelectedColumnsRef.current;
    const currentSub = summarySelectedSubValuesRef.current;

    let changed = false;
    if (draftCols.size !== currentCols.size) {
      changed = true;
    } else {
      for (const col of draftCols) {
        if (!currentCols.has(col)) {
          changed = true;
          break;
        }
      }
    }

    if (!changed) {
      const draftKeys = Object.keys(draftSub);
      const currentKeys = Object.keys(currentSub);
      if (draftKeys.length !== currentKeys.length) {
        changed = true;
      } else {
        for (const k of draftKeys) {
          const dSet = draftSub[k] || new Set();
          const cSet = currentSub[k] || new Set();
          if (dSet.size !== cSet.size) {
            changed = true;
            break;
          }
          for (const v of dSet) {
            if (!cSet.has(v)) {
              changed = true;
              break;
            }
          }
          if (changed) break;
        }
      }
    }

    setSummarySelectedColumns(new Set(draftCols));
    setSummarySelectedSubValues(draftSub);
    if (changed) {
      setSummaryPage(0);
    }
  };

  function handleSummaryHeaderClick(colKey: string) {
    if (summarySortColumn === colKey) {
      if (summarySortDirection === "desc") setSummarySortDirection("asc");
      else if (summarySortDirection === "asc") {
        setSummarySortColumn(null);
        setSummarySortDirection(null);
      } else setSummarySortDirection("desc");
    } else {
      setSummarySortColumn(colKey);
      setSummarySortDirection("desc");
    }
  }

  const prevTableRef = useRef(table);
  const prevWsIdRef = useRef(workspaceId);
  useEffect(() => {
    if (prevTableRef.current !== table || prevWsIdRef.current !== workspaceId) {
      prevTableRef.current = table;
      prevWsIdRef.current = workspaceId;
      setSearch("");
      setSelectedValueFilters({});
      setColumnFilterOperators({});
      setSummarySelectedColumns(new Set());
      setSummarySelectedSubValues({});
      setDraftSummaryColumns(new Set());
      setDraftSummarySubValues({});
      setSummarySortColumn(null);
      setSummarySortDirection(null);
      setSummaryScope("filtered");
      setSummaryPage(0);
    }
  }, [table, workspaceId]);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (valueFilterRef.current && !valueFilterRef.current.contains(e.target as Node)) {
        setIsValueFilterOpen(false);
      }
      if (summaryDropdownRef.current && !summaryDropdownRef.current.contains(e.target as Node)) {
        if (isSummaryDropdownOpenRef.current) {
          commitSummaryDraft();
          setIsSummaryDropdownOpen(false);
        }
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const uniqueColumnValues = useMemo(() => {
    const map: Record<string, string[]> = {};
    table.columns.forEach((col, idx) => {
      const rawSet = new Set<string>();
      table.rows.forEach((row) => {
        const val = row[idx];
        if (val !== null && val !== undefined && val !== "") {
          rawSet.add(String(val));
        }
      });
      map[col.name] = Array.from(rawSet).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
      );
    });
    return map;
  }, [table.columns, table.rows]);

  const activeValueFiltersCount = useMemo(() => {
    return Object.values(selectedValueFilters).reduce((acc, set) => acc + (set ? set.size : 0), 0);
  }, [selectedValueFilters]);

  const rows = useMemo(() => {
    let filtered = table.rows;

    table.columns.forEach((col) => {
      const colName = col.name;
      const colIdx = table.columns.findIndex((c) => c.name === colName);
      if (colIdx < 0) return;

      const selectedSet = selectedValueFilters[colName];
      const op = columnFilterOperators[colName] || "==";

      if (selectedSet && selectedSet.size > 0) {
        filtered = filtered.filter((row) => {
          const rawVal = row[colIdx];
          return evaluateFilterCondition(rawVal, selectedSet, op);
        });
      }
    });

    const normalizedSearch = search.trim().toLowerCase();
    if (normalizedSearch) {
      filtered = filtered.filter((row) =>
        row.some((value) => String(value ?? "").toLowerCase().includes(normalizedSearch))
      );
    }

    if (!sortColumnName || !sortDirection) return filtered;

    const colIndex = table.columns.findIndex((c) => c.name === sortColumnName);
    if (colIndex < 0) return filtered;

    return [...filtered].sort((a, b) => {
      const valA = a[colIndex];
      const valB = b[colIndex];

      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      if (typeof valA === "number" && typeof valB === "number") {
        return sortDirection === "asc" ? valA - valB : valB - valA;
      }

      const strA = String(valA);
      const strB = String(valB);
      const isIsoA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(strA);
      const isIsoB = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(strB);

      if (isIsoA && isIsoB) {
        const timeA = new Date(strA).getTime();
        const timeB = new Date(strB).getTime();
        if (!isNaN(timeA) && !isNaN(timeB)) {
          return sortDirection === "asc" ? timeA - timeB : timeB - timeA;
        }
      }

      const comparison = strA.localeCompare(strB, undefined, { numeric: true, sensitivity: "base" });
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [search, selectedValueFilters, columnFilterOperators, sortColumnName, sortDirection, table.rows, table.columns]);

  const selectedColsList = useMemo(() => {
    return Array.from(summarySelectedColumns);
  }, [summarySelectedColumns]);

  const summarizedData = useMemo(() => {
    const sourceRows = summaryScope === "filtered" ? rows : table.rows;
    if (sourceRows.length === 0) return [];

    if (selectedColsList.length <= 1) {
      const targetCols = selectedColsList.length === 1
        ? table.columns.filter((c) => c.name === selectedColsList[0])
        : table.columns;

      const list: { valuesMap: Record<string, string>; count: number; primaryCol?: string; primaryVal?: string }[] = [];

      targetCols.forEach((col) => {
        const cIdx = table.columns.findIndex((c) => c.name === col.name);
        if (cIdx < 0) return;

        const countsMap = new Map<string, number>();
        sourceRows.forEach((row) => {
          const raw = row[cIdx];
          if (raw !== null && raw !== undefined && raw !== "") {
            const sVal = String(raw);
            countsMap.set(sVal, (countsMap.get(sVal) || 0) + 1);
          }
        });

        const sortedEntries = Array.from(countsMap.entries()).sort((a, b) => b[1] - a[1]);
        sortedEntries.forEach(([val, count]) => {
          const subValSet = summarySelectedSubValues[col.name];
          if (!subValSet || subValSet.size === 0 || subValSet.has(val)) {
            list.push({
              primaryCol: col.name,
              primaryVal: val,
              valuesMap: { [col.name]: val },
              count
            });
          }
        });
      });

      return list;
    }

    const colIndices = selectedColsList.map((colName) => ({
      name: colName,
      idx: table.columns.findIndex((c) => c.name === colName)
    })).filter((item) => item.idx >= 0);

    const tupleMap = new Map<string, { valuesMap: Record<string, string>; count: number; primaryCol?: string; primaryVal?: string }>();

    sourceRows.forEach((row) => {
      for (const { name, idx } of colIndices) {
        const rawVal = row[idx];
        const val = rawVal === null || rawVal === undefined ? "" : String(rawVal);
        const subSet = summarySelectedSubValues[name];
        if (subSet && subSet.size > 0 && !subSet.has(val)) {
          return;
        }
      }

      const valuesMap: Record<string, string> = {};
      const keyParts: string[] = [];

      colIndices.forEach(({ name, idx }) => {
        const rawVal = row[idx];
        const val = rawVal === null || rawVal === undefined ? "" : String(rawVal);
        valuesMap[name] = val;
        keyParts.push(`${name}:::${val}`);
      });

      const key = keyParts.join("|||");
      const existing = tupleMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        tupleMap.set(key, { valuesMap, count: 1 });
      }
    });

    return Array.from(tupleMap.values()).sort((a, b) => b.count - a.count);
  }, [table.columns, table.rows, rows, summaryScope, selectedColsList, summarySelectedSubValues]);

  const sortedSummarizedData = useMemo(() => {
    if (!summarySortColumn || !summarySortDirection) return summarizedData;

    return [...summarizedData].sort((a, b) => {
      let valA: unknown;
      let valB: unknown;

      if (summarySortColumn === "Count" || summarySortColumn === "% Share") {
        valA = a.count;
        valB = b.count;
      } else if (summarySortColumn === "Column Name") {
        valA = a.primaryCol || "";
        valB = b.primaryCol || "";
      } else if (summarySortColumn === "Distinct Output Value") {
        valA = a.primaryVal || "";
        valB = b.primaryVal || "";
      } else {
        valA = a.valuesMap[summarySortColumn] || "";
        valB = b.valuesMap[summarySortColumn] || "";
      }

      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      if (typeof valA === "number" && typeof valB === "number") {
        return summarySortDirection === "asc" ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
      }

      const strA = String(valA);
      const strB = String(valB);
      const comparison = strA.localeCompare(strB, undefined, { numeric: true, sensitivity: "base" });
      return summarySortDirection === "asc" ? comparison : -comparison;
    });
  }, [summarizedData, summarySortColumn, summarySortDirection]);

  const summaryTableHeaders = useMemo(() => {
    if (selectedColsList.length >= 2) {
      return [...selectedColsList, "Count", "% Share"];
    }
    return ["Column Name", "Distinct Output Value", "Count", "% Share"];
  }, [selectedColsList]);

  const summaryPageCount = Math.max(1, Math.ceil(sortedSummarizedData.length / summaryPageSize));
  const pageSummarizedData = useMemo(() => {
    const start = summaryPage * summaryPageSize;
    return sortedSummarizedData.slice(start, start + summaryPageSize);
  }, [sortedSummarizedData, summaryPage, summaryPageSize]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice(page * pageSize, page * pageSize + pageSize);

  function toggleColumn(columnName: string) {
    setVisibleColumns((current) =>
      current.includes(columnName)
        ? current.filter((name) => name !== columnName)
        : [...current, columnName]
    );
  }

  function downloadCsv() {
    const orderedCols = table.columns
      .filter((c) => visibleColumns.includes(c.name))
      .sort((a, b) => orderedVisibleColumns.indexOf(a.name) - orderedVisibleColumns.indexOf(b.name));

    const csv = toCsv(orderedCols, rows, useLocalTime);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${table.name || "query-results"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const colIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    table.columns.forEach((col, idx) => map.set(col.name, idx));
    return map;
  }, [table.columns]);

  return (
    <article className="table-section">
      <div className="panel-header" style={{ alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h2>{table.name || "Results"}</h2>
            <p>{rows.length} rows, {table.columns.length} columns</p>
          </div>

          <div ref={valueFilterRef} style={{ position: "relative" }}>
            <button
              type="button"
              className="primary-button"
              onClick={(e) => {
                e.stopPropagation();
                setIsValueFilterOpen(!isValueFilterOpen);
                setHoveredColumn(null);
                setFlyoutSearch("");
              }}
              style={{
                width: "auto",
                padding: "0 14px",
                height: "36px",
                fontSize: "12px",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                borderRadius: "8px"
              }}
            >
              <Filter size={15} />
              <span>Filter Values {activeValueFiltersCount > 0 ? `(${activeValueFiltersCount})` : ""}</span>
              <ChevronRight size={14} />
            </button>

            {isValueFilterOpen && (
              <div className="cascading-menu-container left-aligned" onClick={(e) => e.stopPropagation()}>
                <div className="cascading-menu-left">
                  <div className="cascading-menu-title">
                    <span>Columns</span>
                    {activeValueFiltersCount > 0 && (
                      <button
                        type="button"
                        className="clear-all-link"
                        onClick={() => setSelectedValueFilters({})}
                      >
                        Reset All
                      </button>
                    )}
                  </div>
                  <div className="cascading-column-list">
                    {table.columns.map((col) => {
                      const count = selectedValueFilters[col.name]?.size || 0;
                      const isHovered = hoveredColumn === col.name;

                      return (
                        <div
                          key={col.name}
                          className={`cascading-column-item ${isHovered ? "is-hovered" : ""} ${count > 0 ? "has-active" : ""}`}
                          onMouseEnter={() => {
                            if (hoveredColumn !== col.name) {
                              setHoveredColumn(col.name);
                              setFlyoutSearch("");
                            }
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden" }}>
                            <span className="col-name" title={col.name}>{col.name}</span>
                            {count > 0 && <span className="active-badge">{count}</span>}
                          </div>
                          <ChevronRight size={14} className="arrow-icon" />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {hoveredColumn && (
                  <div className="cascading-menu-right">
                    <div className="flyout-header" style={{ flexDirection: "column", gap: "8px", alignItems: "flex-start" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                        <span className="flyout-title" title={hoveredColumn}>{hoveredColumn}</span>
                        <div className="flyout-actions">
                          <button
                            type="button"
                            onClick={() => {
                              const currentOp = columnFilterOperators[hoveredColumn] || "==";
                              const visibleValues = (uniqueColumnValues[hoveredColumn] || []).filter(
                                (val) => matchesValueOperator(val, currentOp, flyoutSearch)
                              );
                              setSelectedValueFilters((prev) => {
                                const nextSet = new Set(prev[hoveredColumn] || []);
                                visibleValues.forEach((v) => nextSet.add(v));
                                return { ...prev, [hoveredColumn]: nextSet };
                              });
                            }}
                          >
                            Select All
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedValueFilters((prev) => ({
                                ...prev,
                                [hoveredColumn]: new Set()
                              }));
                            }}
                          >
                            Deselect All
                          </button>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "6px", width: "100%", minWidth: 0, boxSizing: "border-box" }}>
                        <span style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 600, flexShrink: 0 }}>Operator:</span>
                        <select
                          value={columnFilterOperators[hoveredColumn] || "=="}
                          onChange={(e) => {
                            const newOp = e.target.value as FilterOperator;
                            setColumnFilterOperators((prev) => ({ ...prev, [hoveredColumn]: newOp }));
                          }}
                          style={{
                            background: "rgba(4, 20, 28, 0.95)",
                            border: "1px solid rgba(16, 185, 129, 0.4)",
                            borderRadius: "4px",
                            color: "#34d399",
                            fontSize: "11px",
                            fontWeight: 700,
                            padding: "3px 6px",
                            outline: "none",
                            cursor: "pointer",
                            flex: 1,
                            minWidth: 0,
                            maxWidth: "100%",
                            boxSizing: "border-box",
                            textOverflow: "ellipsis"
                          }}
                        >
                          <option value="==">== (Equals)</option>
                          <option value="!=">!= (Not Equals)</option>
                          <option value="contains">contains (Contains)</option>
                          <option value="!contains">!contains (Does Not Contain)</option>
                          <option value="<">&lt; (Less Than)</option>
                          <option value="<=">&lt;= (Less Than or Equal To)</option>
                          <option value=">">&gt; (Greater Than)</option>
                          <option value=">=">&gt;= (Greater Than or Equal To)</option>
                        </select>
                      </div>
                    </div>

                    <div className="flyout-search">
                      <Search size={13} className="search-icon" />
                      <input
                        type="text"
                        placeholder={`Filter ${hoveredColumn} values...`}
                        value={flyoutSearch}
                        onChange={(e) => setFlyoutSearch(e.target.value)}
                      />
                      {flyoutSearch && (
                        <button
                          type="button"
                          className="clear-btn"
                          onClick={() => setFlyoutSearch("")}
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div className="flyout-values-list">
                      {(uniqueColumnValues[hoveredColumn] || [])
                        .filter((val) => {
                          const currentOp = columnFilterOperators[hoveredColumn] || "==";
                          return matchesValueOperator(val, currentOp, flyoutSearch);
                        })
                        .map((val) => {
                          const currentSet = selectedValueFilters[hoveredColumn] || new Set();
                          const isChecked = currentSet.has(val);

                          return (
                            <div
                              key={val}
                              className={`flyout-value-item ${isChecked ? "is-selected" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedValueFilters((prev) => {
                                  const nextSet = new Set(prev[hoveredColumn] || []);
                                  if (nextSet.has(val)) nextSet.delete(val);
                                  else nextSet.add(val);
                                  return { ...prev, [hoveredColumn]: nextSet };
                                });
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {}}
                              />
                              <span title={val}>{val}</span>
                            </div>
                          );
                        })}
                      {(uniqueColumnValues[hoveredColumn] || []).length === 0 && (
                        <div className="empty-flyout">No values found</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="toolbar" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "10px" }}>
          <label className="search">
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              placeholder="Search rows..."
            />
          </label>
          <button
            className="icon-button"
            onClick={() => setUseLocalTime(!useLocalTime)}
            title="Toggle timezone"
            style={{ width: "auto", padding: "6px 12px", height: "36px", fontSize: "12px", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <Clock size={15} />
            <span>{useLocalTime ? "Local Time" : "UTC Time"}</span>
          </button>
          <button
            className="icon-button"
            onClick={() => setGlobalWrapText(!globalWrapText)}
            title="Toggle single line vs wrapped text for all cells (or double-click vertical/horizontal grid lines)"
            style={{
              width: "auto",
              padding: "6px 12px",
              height: "36px",
              fontSize: "12px",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: globalWrapText ? "rgba(111, 123, 96, 0.14)" : "var(--glass-surface)",
              borderColor: globalWrapText ? "#6F7B60" : "var(--glass-border)",
              color: globalWrapText ? "#6F7B60" : "var(--color-text-primary)"
            }}
          >
            <SlidersHorizontal size={15} />
            <span>{globalWrapText ? "Wrapped Text" : "Single Line (No Wrap)"}</span>
          </button>
          <button 
            className="icon-button" 
            onClick={downloadCsv} 
            title="Download CSV"
            style={{ width: "auto", padding: "6px 12px", height: "36px", fontSize: "12px", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <Download size={15} />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      <details className="columns-control">
        <summary>
          <Columns3 size={16} />
          Columns ({visibleColumns.length} / {table.columns.length} visible)
        </summary>
        <div className="column-list">
          {table.columns.map((column) => (
            <label key={column.name}>
              <input
                type="checkbox"
                checked={visibleColumns.includes(column.name)}
                onChange={() => toggleColumn(column.name)}
              />
              <span>{column.name}</span>
            </label>
          ))}
        </div>
      </details>

      <div className="table-container-outer">
        <div className="table-body-wrap">
          <table style={{ width: "max-content", minWidth: "100%" }}>
            <thead>
              <tr>
                {orderedVisibleColumns.map((colName) => {
                  const width = columnWidths[colName] ?? getDefaultColumnWidth(colName);
                  const isSortActive = sortColumnName === colName;
                  return (
                    <th
                      key={colName}
                      draggable
                      onDragStart={(e) => handleDragStart(e, colName)}
                      onDragOver={handleDragOver}
                      onDragEnd={handleDragEnd}
                      onDrop={(e) => handleDrop(e, colName)}
                      className={`th-reorderable ${draggedColumn === colName ? "is-dragging" : ""}`}
                      title="Click & drag to reorder, or click to sort"
                      style={{
                        width: `${width}px`,
                        minWidth: `${width}px`,
                        maxWidth: `${width}px`,
                        cursor: draggedColumn === colName ? "grabbing" : "grab"
                      }}
                    >
                      <div className="th-container">
                        <button
                          type="button"
                          className="th-sort-btn"
                          onClick={() => handleSort(colName)}
                          title={`Click to sort by ${colName}`}
                        >
                          <span>{colName}</span>
                          {isSortActive ? (
                            <span className="sort-arrow">{sortDirection === "asc" ? " ▲" : " ▼"}</span>
                          ) : (
                            <span className="sort-arrow-idle"> ↕</span>
                          )}
                        </button>
                      </div>

                      <div
                        className="col-resize-handle"
                        onMouseDown={(e) => handleResizeStart(e, colName, width)}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          toggleColumnWrap(colName);
                        }}
                        title="Drag to resize, or double-click vertical line to toggle text wrap for this column"
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(1, orderedVisibleColumns.length)}>No rows match the current view.</td>
                </tr>
              ) : (
                pageRows.map((row, rowIndex) => {
                  const isRowWrapped = wrappedRows.has(rowIndex);
                  return (
                    <tr
                      key={`${page}-${rowIndex}`}
                      className="table-row-item"
                      onDoubleClick={() => toggleRowWrap(rowIndex)}
                      title="Double-click row/horizontal line to toggle text wrap for this row"
                    >
                      {orderedVisibleColumns.map((colName) => {
                        const dataIdx = colIndexMap.get(colName);
                        const cellVal = dataIdx !== undefined ? row[dataIdx] : "";
                        const width = columnWidths[colName] ?? getDefaultColumnWidth(colName);
                        const isColWrapped = wrappedColumns.has(colName);
                        const isCellWrapped = globalWrapText || isColWrapped || isRowWrapped;
                        const formattedText = formatCell(cellVal, useLocalTime);

                        return (
                          <td
                            key={colName}
                            style={{
                              width: `${width}px`,
                              minWidth: `${width}px`,
                              maxWidth: `${width}px`
                            }}
                          >
                            <span
                              className={isCellWrapped ? "cell-content-wrap" : "cell-content-nowrap"}
                              title={formattedText}
                            >
                              {formattedText}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="pager">
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
          <button
            onClick={() => setPage(0)}
            disabled={page === 0}
            title={page === 0 ? "Already on first page" : "Go to first page"}
            style={{ padding: "6px 10px", fontSize: "12px" }}
          >
            First
          </button>
          <button
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            disabled={page === 0}
            title={page === 0 ? "No previous page" : "Go to previous page"}
            style={{ padding: "6px 12px", fontSize: "12px" }}
          >
            Previous
          </button>

          <span style={{ margin: "0 4px", fontSize: "12px", color: "var(--color-text-primary)", fontWeight: 600 }}>
            Page {page + 1} of {pageCount} ({rows.length} rows)
          </span>

          {/* Clickable Page Numbers */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
            {getPageNumbers(page, pageCount).map((p, pIdx) =>
              p === "..." ? (
                <span key={`ellipsis-${pIdx}`} className="pager-ellipsis" style={{ padding: "0 4px", color: "var(--color-text-muted)" }}>
                  …
                </span>
              ) : (
                <button
                  key={`page-${p}`}
                  type="button"
                  onClick={() => setPage((p as number) - 1)}
                  className={`pager-page-btn ${(p as number) - 1 === page ? "is-active" : ""}`}
                  style={{
                    minWidth: "30px",
                    height: "30px",
                    padding: "0 6px",
                    fontSize: "12px",
                    fontWeight: (p as number) - 1 === page ? 700 : 500,
                    borderRadius: "6px",
                    background: (p as number) - 1 === page ? "#6F7B60" : "var(--glass-surface-elevated)",
                    color: (p as number) - 1 === page ? "#FEFCFF" : "var(--color-text-primary)",
                    border: `1px solid ${(p as number) - 1 === page ? "#6F7B60" : "var(--glass-border)"}`,
                    cursor: (p as number) - 1 === page ? "default" : "pointer"
                  }}
                  title={`Go to page ${p}`}
                >
                  {p}
                </button>
              )
            )}
          </div>

          <button
            onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
            disabled={page >= pageCount - 1}
            title={page >= pageCount - 1 ? "Already on last page" : "Go to next page"}
            style={{ padding: "6px 12px", fontSize: "12px" }}
          >
            Next
          </button>
          <button
            onClick={() => setPage(pageCount - 1)}
            disabled={page >= pageCount - 1}
            title={page >= pageCount - 1 ? "Already on last page" : "Go to last page"}
            style={{ padding: "6px 10px", fontSize: "12px" }}
          >
            Last
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <label htmlFor="rows-per-page-select" style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-muted)" }}>
            Rows per page:
          </label>
          <select
            id="rows-per-page-select"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
            style={{
              background: "var(--glass-surface)",
              border: "1px solid var(--glass-border)",
              borderRadius: "6px",
              padding: "4px 8px",
              color: "var(--color-text-primary)",
              fontSize: "12px",
              fontWeight: 600,
              outline: "none",
              cursor: "pointer"
            }}
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50 (Default)</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
        </div>
      </div>

      {/* Bottom Summarized Telemetry Table */}
      <article className="table-section summary-telemetry-section" style={{ marginTop: "24px", paddingTop: "16px" }}>
        <div className="panel-header" style={{ alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                <BarChart3 size={18} color="#6F7B60" />
                <span>Summarized Column Telemetry</span>
              </h3>
              <p style={{ fontSize: "12px", color: "var(--color-text-muted)", margin: "4px 0 0 0" }}>
                {selectedColsList.length >= 2
                  ? `KQL Group By: | summarize count() by ${selectedColsList.join(", ")}`
                  : "Frequency count & percentage share per column value."}
              </p>
            </div>

            <div ref={summaryDropdownRef} style={{ position: "relative" }}>
              <button
                type="button"
                className="icon-button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isSummaryDropdownOpen) {
                    setDraftSummaryColumns(new Set(summarySelectedColumns));
                    setDraftSummarySubValues(summarySelectedSubValues);
                    setIsSummaryDropdownOpen(true);
                    setSummaryHoveredCol(null);
                  } else {
                    commitSummaryDraft();
                    setIsSummaryDropdownOpen(false);
                  }
                }}
                style={{
                  width: "auto",
                  padding: "6px 12px",
                  height: "34px",
                  fontSize: "12px",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: (isSummaryDropdownOpen ? draftSummaryColumns.size : summarySelectedColumns.size) > 0 ? "rgba(111, 123, 96, 0.14)" : "var(--glass-surface)",
                  border: `1px solid ${(isSummaryDropdownOpen ? draftSummaryColumns.size : summarySelectedColumns.size) > 0 ? "#6F7B60" : "var(--glass-border)"}`,
                  color: (isSummaryDropdownOpen ? draftSummaryColumns.size : summarySelectedColumns.size) > 0 ? "#6F7B60" : "var(--color-text-primary)",
                  borderRadius: "6px"
                }}
              >
                <SlidersHorizontal size={14} color="#6F7B60" />
                <span>
                  Filter Columns & Values{" "}
                  {(isSummaryDropdownOpen ? draftSummaryColumns.size : summarySelectedColumns.size) > 0
                    ? `(${isSummaryDropdownOpen ? draftSummaryColumns.size : summarySelectedColumns.size})`
                    : "(All)"}
                </span>
                {isSummaryDropdownOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {isSummaryDropdownOpen && (
                <div
                  className="cascading-menu-container left-aligned"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="cascading-menu-left">
                    <div className="cascading-menu-title">
                      <span>Columns ({table.columns.length})</span>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          type="button"
                          className="clear-all-link"
                          onClick={() => {
                            setDraftSummaryColumns(new Set(table.columns.map((c) => c.name)));
                          }}
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          className="clear-all-link"
                          onClick={() => {
                            setDraftSummaryColumns(new Set());
                            setDraftSummarySubValues({});
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <div className="cascading-column-list">
                      {table.columns.map((col) => {
                        const isColChecked = draftSummaryColumns.has(col.name);
                        const subCount = draftSummarySubValues[col.name]?.size || 0;
                        const isHovered = summaryHoveredCol === col.name;

                        return (
                          <div
                            key={col.name}
                            className={`cascading-column-item ${isHovered ? "is-hovered" : ""} ${isColChecked ? "has-active" : ""}`}
                            onMouseEnter={() => {
                              if (summaryHoveredCol !== col.name) {
                                setSummaryHoveredCol(col.name);
                              }
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setDraftSummaryColumns((prev) => {
                                const next = new Set(prev);
                                if (next.has(col.name)) {
                                  next.delete(col.name);
                                  setDraftSummarySubValues((subPrev) => ({ ...subPrev, [col.name]: new Set() }));
                                } else {
                                  next.add(col.name);
                                }
                                return next;
                              });
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden" }}>
                              <input
                                type="checkbox"
                                checked={isColChecked}
                                onChange={() => {}}
                              />
                              <span className="col-name" title={col.name}>{col.name}</span>
                              {subCount > 0 && <span className="active-badge">{subCount}</span>}
                            </div>
                            <ChevronRight size={14} className="arrow-icon" />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {summaryHoveredCol && (
                    <div className="cascading-menu-right">
                      <div className="flyout-header">
                        <span className="flyout-title" title={summaryHoveredCol}>{summaryHoveredCol}</span>
                        <div className="flyout-actions">
                          <button
                            type="button"
                            onClick={() => {
                              const values = uniqueColumnValues[summaryHoveredCol] || [];
                              setDraftSummarySubValues((prev) => ({
                                ...prev,
                                [summaryHoveredCol]: new Set(values)
                              }));
                              if (values.length > 0) {
                                setDraftSummaryColumns((prev) => new Set(prev).add(summaryHoveredCol));
                              }
                            }}
                          >
                            Select All
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDraftSummarySubValues((prev) => ({
                                ...prev,
                                [summaryHoveredCol]: new Set()
                              }));
                              setDraftSummaryColumns((prev) => {
                                const next = new Set(prev);
                                next.delete(summaryHoveredCol);
                                return next;
                              });
                            }}
                          >
                            Deselect All
                          </button>
                        </div>
                      </div>

                      <div className="flyout-values-list">
                        {(uniqueColumnValues[summaryHoveredCol] || []).map((val) => {
                          const currentSet = draftSummarySubValues[summaryHoveredCol] || new Set();
                          const isChecked = currentSet.has(val);

                          return (
                            <div
                              key={val}
                              className={`flyout-value-item ${isChecked ? "is-selected" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                const nextSet = new Set(draftSummarySubValues[summaryHoveredCol] || []);
                                if (nextSet.has(val)) nextSet.delete(val);
                                else nextSet.add(val);

                                setDraftSummarySubValues((prev) => ({
                                  ...prev,
                                  [summaryHoveredCol]: nextSet
                                }));

                                setDraftSummaryColumns((prev) => {
                                  const nextCols = new Set(prev);
                                  if (nextSet.size > 0) {
                                    nextCols.add(summaryHoveredCol);
                                  } else {
                                    nextCols.delete(summaryHoveredCol);
                                  }
                                  return nextCols;
                                });
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {}}
                              />
                              <span title={val}>{val}</span>
                            </div>
                          );
                        })}
                        {(uniqueColumnValues[summaryHoveredCol] || []).length === 0 && (
                          <div className="empty-flyout">No distinct values</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginLeft: "auto" }}>
            <div style={{ display: "inline-flex", background: "var(--glass-surface-elevated)", border: "1px solid var(--glass-border)", borderRadius: "6px", padding: "2px" }}>
              <button
                type="button"
                onClick={() => setSummaryScope("filtered")}
                style={{
                  padding: "4px 10px",
                  fontSize: "11px",
                  fontWeight: 600,
                  borderRadius: "4px",
                  border: "none",
                  background: summaryScope === "filtered" ? "#6F7B60" : "transparent",
                  color: summaryScope === "filtered" ? "#FEFCFF" : "var(--color-text-muted)",
                  cursor: "pointer"
                }}
                title="Summarize frequencies based on active filtered rows"
              >
                Filtered ({rows.length})
              </button>
              <button
                type="button"
                onClick={() => setSummaryScope("all")}
                style={{
                  padding: "4px 10px",
                  fontSize: "11px",
                  fontWeight: 600,
                  borderRadius: "4px",
                  border: "none",
                  background: summaryScope === "all" ? "#6F7B60" : "transparent",
                  color: summaryScope === "all" ? "#FEFCFF" : "var(--color-text-muted)",
                  cursor: "pointer"
                }}
                title="Summarize frequencies based on total un-filtered rows"
              >
                All Rows ({table.rows.length})
              </button>
            </div>
          </div>
        </div>

        {activeValueFiltersCount > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "14px", padding: "8px 12px", background: "rgba(111, 123, 96, 0.12)", border: "1px solid rgba(111, 123, 96, 0.3)", borderRadius: "8px" }}>
            <span style={{ fontSize: "12px", color: "#6F7B60", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
              <Filter size={14} /> Active Primary Filters ({activeValueFiltersCount}):
            </span>
            {Object.entries(selectedValueFilters).map(([colName, set]) => {
              if (!set || set.size === 0) return null;
              const op = columnFilterOperators[colName] || "==";
              return Array.from(set).map((val) => (
                <span
                  key={`${colName}-${val}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    background: "var(--glass-surface)",
                    border: "1px solid var(--glass-border)",
                    borderRadius: "6px",
                    padding: "3px 8px",
                    fontSize: "11px",
                    color: "var(--color-text-primary)"
                  }}
                >
                  <span style={{ color: "var(--color-text-muted)" }}>{colName}</span>
                  <span style={{ color: "#6F7B60", fontWeight: 700 }}>{op}</span>
                  <strong style={{ color: "var(--color-text-primary)" }}>"{val}"</strong>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedValueFilters((prev) => {
                        const nextSet = new Set(prev[colName] || []);
                        nextSet.delete(val);
                        return { ...prev, [colName]: nextSet };
                      });
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--color-text-muted)",
                      cursor: "pointer",
                      fontSize: "12px",
                      padding: "0 2px",
                      display: "inline-flex",
                      alignItems: "center"
                    }}
                    title="Remove filter value"
                  >
                    ✕
                  </button>
                </span>
              ));
            })}
            <button
              type="button"
              onClick={() => setSelectedValueFilters({})}
              style={{
                background: "rgba(220, 38, 38, 0.08)",
                border: "1px solid rgba(220, 38, 38, 0.3)",
                color: "#dc2626",
                fontSize: "11px",
                fontWeight: 600,
                padding: "3px 8px",
                borderRadius: "6px",
                cursor: "pointer"
              }}
            >
              Clear All Filters
            </button>
          </div>
        )}

        <div className="table-container-outer">
          <div className="summary-table-body-wrap">
            <table style={{ width: "max-content", minWidth: "100%" }}>
              <thead>
                <tr>
                  {summaryTableHeaders.map((colKey) => {
                    const width = summaryColumnWidths[colKey] ?? getDefaultSummaryColumnWidth(colKey);
                    const isSortActive = summarySortColumn === colKey;
                    const isCountOrPct = colKey === "Count" || colKey === "% Share";

                    return (
                      <th
                        key={colKey}
                        className="th-reorderable"
                        title={isCountOrPct ? `Click to sort by ${colKey}` : `Click to sort by ${colKey}, drag right edge to resize`}
                        style={{
                          width: `${width}px`,
                          minWidth: `${width}px`,
                          maxWidth: `${width}px`
                        }}
                      >
                        <div className="th-container">
                          <button
                            type="button"
                            className="th-sort-btn"
                            onClick={() => handleSummaryHeaderClick(colKey)}
                            title={`Click to sort by ${colKey}`}
                          >
                            <span>{colKey}</span>
                            {isSortActive ? (
                              <span className="sort-arrow">{summarySortDirection === "asc" ? " ▲" : " ▼"}</span>
                            ) : (
                              <span className="sort-arrow-idle"> ↕</span>
                            )}
                          </button>
                        </div>

                        <div
                          className="col-resize-handle"
                          onMouseDown={(e) => handleSummaryResizeStart(e, colKey, width)}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            toggleSummaryColWrap(colKey);
                          }}
                          title="Drag to resize column width, or double-click to toggle text wrap"
                        />
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedSummarizedData.length === 0 ? (
                  <tr>
                    <td colSpan={summaryTableHeaders.length} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "24px" }}>
                      No summarized data matches selection.
                    </td>
                  </tr>
                ) : (
                  pageSummarizedData.map((item, idx) => {
                    const totalRefRows = summaryScope === "filtered" ? rows.length : table.rows.length;
                    const pct = totalRefRows > 0 ? ((item.count / totalRefRows) * 100).toFixed(1) : "0.0";

                    return (
                      <tr key={idx} className="table-row-item">
                        {selectedColsList.length >= 2 ? (
                          selectedColsList.map((colName) => {
                            const width = summaryColumnWidths[colName] ?? getDefaultSummaryColumnWidth(colName);
                            const val = item.valuesMap[colName] || "";
                            const isWrapped = summaryWrappedCols.has(colName);

                            return (
                              <td
                                key={colName}
                                style={{
                                  width: `${width}px`,
                                  minWidth: `${width}px`,
                                  maxWidth: `${width}px`
                                }}
                              >
                                <span
                                  className={isWrapped ? "cell-content-wrap" : "cell-content-nowrap"}
                                  style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-primary)", fontSize: "12px" }}
                                  title={val}
                                >
                                  {val}
                                </span>
                              </td>
                            );
                          })
                        ) : (
                          <>
                            {(() => {
                              const colWidth = summaryColumnWidths["Column Name"] ?? getDefaultSummaryColumnWidth("Column Name");
                              const isWrapped = summaryWrappedCols.has("Column Name");
                              return (
                                <td
                                  style={{
                                    width: `${colWidth}px`,
                                    minWidth: `${colWidth}px`,
                                    maxWidth: `${colWidth}px`
                                  }}
                                >
                                  <span
                                    className={isWrapped ? "cell-content-wrap" : "cell-content-nowrap"}
                                    style={{ fontWeight: 600, color: "var(--color-accent-action)", fontSize: "12px" }}
                                    title={item.primaryCol}
                                  >
                                    {item.primaryCol}
                                  </span>
                                </td>
                              );
                            })()}
                            {(() => {
                              const valWidth = summaryColumnWidths["Distinct Output Value"] ?? getDefaultSummaryColumnWidth("Distinct Output Value");
                              const isWrapped = summaryWrappedCols.has("Distinct Output Value");
                              return (
                                <td
                                  style={{
                                    width: `${valWidth}px`,
                                    minWidth: `${valWidth}px`,
                                    maxWidth: `${valWidth}px`
                                  }}
                                >
                                  <span
                                    className={isWrapped ? "cell-content-wrap" : "cell-content-nowrap"}
                                    style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-primary)", fontSize: "12px" }}
                                    title={item.primaryVal}
                                  >
                                    {item.primaryVal}
                                  </span>
                                </td>
                              );
                            })()}
                          </>
                        )}
                        {(() => {
                          const countWidth = summaryColumnWidths["Count"] ?? getDefaultSummaryColumnWidth("Count");
                          return (
                            <td
                              style={{
                                width: `${countWidth}px`,
                                minWidth: `${countWidth}px`,
                                maxWidth: `${countWidth}px`,
                                textAlign: "right",
                                fontWeight: 700,
                                color: "var(--color-accent-action)"
                              }}
                            >
                              {item.count.toLocaleString()}
                            </td>
                          );
                        })()}
                        {(() => {
                          const pctWidth = summaryColumnWidths["% Share"] ?? getDefaultSummaryColumnWidth("% Share");
                          return (
                            <td
                              style={{
                                width: `${pctWidth}px`,
                                minWidth: `${pctWidth}px`,
                                maxWidth: `${pctWidth}px`
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <div style={{ flex: 1, height: "6px", background: "rgba(164, 173, 140, 0.2)", borderRadius: "3px", overflow: "hidden" }}>
                                  <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg, #6F7B60, #A4AD8C)", borderRadius: "3px" }} />
                                </div>
                                <span style={{ fontSize: "11px", color: "var(--color-text-muted)", width: "42px", textAlign: "right", flexShrink: 0 }}>{pct}%</span>
                              </div>
                            </td>
                          );
                        })()}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="pager" style={{ marginTop: "12px", paddingTop: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            <button
              onClick={() => setSummaryPage(0)}
              disabled={summaryPage === 0}
              title={summaryPage === 0 ? "Already on first page" : "Go to first page"}
              style={{ padding: "6px 10px", fontSize: "12px" }}
            >
              First
            </button>
            <button
              onClick={() => setSummaryPage((current) => Math.max(0, current - 1))}
              disabled={summaryPage === 0}
              title={summaryPage === 0 ? "No previous page" : "Go to previous page"}
              style={{ padding: "6px 12px", fontSize: "12px" }}
            >
              Previous
            </button>

            <span style={{ margin: "0 4px", fontSize: "12px", color: "var(--color-text-primary)", fontWeight: 600 }}>
              Page {summaryPage + 1} of {summaryPageCount} ({sortedSummarizedData.length} distinct groups)
            </span>

            {/* Clickable Page Numbers */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              {getPageNumbers(summaryPage, summaryPageCount).map((p, pIdx) =>
                p === "..." ? (
                  <span key={`summary-ellipsis-${pIdx}`} className="pager-ellipsis" style={{ padding: "0 4px", color: "var(--color-text-muted)" }}>
                    …
                  </span>
                ) : (
                  <button
                    key={`summary-page-${p}`}
                    type="button"
                    onClick={() => setSummaryPage((p as number) - 1)}
                    className={`pager-page-btn ${(p as number) - 1 === summaryPage ? "is-active" : ""}`}
                    style={{
                      minWidth: "30px",
                      height: "30px",
                      padding: "0 6px",
                      fontSize: "12px",
                      fontWeight: (p as number) - 1 === summaryPage ? 700 : 500,
                      borderRadius: "6px",
                      background: (p as number) - 1 === summaryPage ? "#6F7B60" : "var(--glass-surface-elevated)",
                      color: (p as number) - 1 === summaryPage ? "#FEFCFF" : "var(--color-text-primary)",
                      border: `1px solid ${(p as number) - 1 === summaryPage ? "#6F7B60" : "var(--glass-border)"}`,
                      cursor: (p as number) - 1 === summaryPage ? "default" : "pointer"
                    }}
                    title={`Go to page ${p}`}
                  >
                    {p}
                  </button>
                )
              )}
            </div>

            <button
              onClick={() => setSummaryPage((current) => Math.min(summaryPageCount - 1, current + 1))}
              disabled={summaryPage >= summaryPageCount - 1}
              title={summaryPage >= summaryPageCount - 1 ? "Already on last page" : "Go to next page"}
              style={{ padding: "6px 12px", fontSize: "12px" }}
            >
              Next
            </button>
            <button
              onClick={() => setSummaryPage(summaryPageCount - 1)}
              disabled={summaryPage >= summaryPageCount - 1}
              title={summaryPage >= summaryPageCount - 1 ? "Already on last page" : "Go to last page"}
              style={{ padding: "6px 10px", fontSize: "12px" }}
            >
              Last
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label htmlFor="summary-rows-per-page" style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-muted)" }}>
              Rows per page:
            </label>
            <select
              id="summary-rows-per-page"
              value={summaryPageSize}
              onChange={(e) => {
                setSummaryPageSize(Number(e.target.value));
                setSummaryPage(0);
              }}
              style={{
                background: "var(--glass-surface)",
                border: "1px solid var(--glass-border)",
                borderRadius: "6px",
                padding: "4px 8px",
                color: "var(--color-text-primary)",
                fontSize: "12px",
                fontWeight: 600,
                outline: "none",
                cursor: "pointer"
              }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50 (Default)</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={500}>500</option>
              <option value={1000}>1000</option>
            </select>
          </div>
        </div>
      </article>
    </article>
  );
}
