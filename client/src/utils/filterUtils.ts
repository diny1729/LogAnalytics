import type { FilterOperator, PresetOption } from "../types";

export function formatFilterClause(field: string, val: string | string[]): string {
  if (Array.isArray(val)) {
    if (val.length === 0) return "";
    if (val.length === 1) return `| where ${field} == "${val[0]}"`;
    return `| where ${field} in (${val.map((v) => `"${v}"`).join(", ")})`;
  }
  return val ? `| where ${field} == "${val}"` : "";
}

export function getRelatedColumns(
  queryText: string = "",
  tableColumns: string[] = [],
  presetProjectCols?: Set<string>
): string[] {
  if (!tableColumns || tableColumns.length === 0) return [];

  const text = queryText || "";
  // Strip single-line KQL comments (lines starting with // or inline //)
  const activeCode = text
    .split("\n")
    .map((line) => {
      const commentIdx = line.indexOf("//");
      return commentIdx >= 0 ? line.slice(0, commentIdx) : line;
    })
    .join("\n");

  // 1. Check for | summarize clause
  const summarizeMatch = activeCode.match(/\|\s*summarize\s+([^|]+)/i);
  if (summarizeMatch) {
    return tableColumns;
  }

  // 2. Check for | project clause (take the last active | project clause)
  const projectMatches = [...activeCode.matchAll(/\|\s*project\s+([^|]+)/gi)];
  if (projectMatches.length > 0) {
    const lastProjectClause = (projectMatches[projectMatches.length - 1]?.[1] ?? "").trim();
    const projectedNames = lastProjectClause
      .split(",")
      .map((item) => {
        const parts = (item ?? "").trim().split("=");
        return (parts[0] ?? "").trim();
      })
      .filter(Boolean);

    const projectedSet = new Set(projectedNames.map((n) => n.toLowerCase()));
    const matched = tableColumns.filter((col) => projectedSet.has((col ?? "").toLowerCase()));
    if (matched.length > 0) {
      return matched;
    }
  }

  // 3. Check presetProjectCols if present
  if (presetProjectCols && presetProjectCols.size > 0) {
    const matched = tableColumns.filter((col) => presetProjectCols.has(col));
    if (matched.length > 0) {
      return matched;
    }
  }

  // 4. Default fallback: all columns returned
  return tableColumns;
}

export function matchesValueOperator(valStr: unknown, op: FilterOperator, searchStr: unknown): boolean {
  const searchTerm = String(searchStr ?? "").trim();
  if (!searchTerm) return true;

  const val = String(valStr ?? "");
  const valLower = val.toLowerCase();
  const searchLower = searchTerm.toLowerCase();

  if (op === "contains") {
    return valLower.includes(searchLower);
  }
  if (op === "!contains") {
    return !valLower.includes(searchLower);
  }
  if (op === "==") {
    return valLower === searchLower;
  }
  if (op === "!=") {
    return valLower !== searchLower;
  }

  // Numeric or Date Comparison operators: <, <=, >, >=
  const numVal = Number(val);
  const numTarget = Number(searchTerm);
  const isValNum = val.trim() !== "" && !isNaN(numVal);
  const isTargetNum = !isNaN(numTarget);

  if (isValNum && isTargetNum) {
    if (op === "<") return numVal < numTarget;
    if (op === "<=") return numVal <= numTarget;
    if (op === ">") return numVal > numTarget;
    if (op === ">=") return numVal >= numTarget;
  }

  const dateVal = new Date(val).getTime();
  const dateTarget = new Date(searchTerm).getTime();
  const isValDate = !isNaN(dateVal) && (val.includes("-") || val.includes(":"));
  const isTargetDate = !isNaN(dateTarget);

  if (isValDate && isTargetDate) {
    if (op === "<") return dateVal < dateTarget;
    if (op === "<=") return dateVal <= dateTarget;
    if (op === ">") return dateVal > dateTarget;
    if (op === ">=") return dateVal >= dateTarget;
  }

  // Fallback to string locale comparison
  const cmp = val.localeCompare(searchTerm, undefined, { numeric: true, sensitivity: "base" });
  if (op === "<") return cmp < 0;
  if (op === "<=") return cmp <= 0;
  if (op === ">") return cmp > 0;
  if (op === ">=") return cmp >= 0;

  return false;
}

export function evaluateFilterCondition(
  rawVal: unknown,
  selectedSet: Set<string>,
  op: FilterOperator
): boolean {
  if (!selectedSet || selectedSet.size === 0) return true;
  const strVal = rawVal === null || rawVal === undefined ? "" : String(rawVal);

  if (op === "==" || op === "contains") {
    return selectedSet.has(strVal);
  }
  if (op === "!=" || op === "!contains") {
    return !selectedSet.has(strVal);
  }

  // Comparison operators: <, <=, >, >=
  return Array.from(selectedSet).some((targetStr) =>
    matchesValueOperator(strVal, op, targetStr)
  );
}

export function isNumericFieldOrOp(field: string, op: string, val: string): boolean {
  if (["<", "<=", ">", ">="].includes(op)) return true;
  const isNumericName = /(_d|_i|_long|_real|_b|_count|_port|Port|Latency|Status|Size|Length|Duration|TimeTaken)$/i.test(field) || /^timeTaken/i.test(field);
  if (isNumericName) return true;
  const trimmed = val.trim();
  if (trimmed !== "" && !isNaN(Number(trimmed)) && !trimmed.startsWith("0x")) return true;
  return false;
}

export function buildOptionClause(opt: PresetOption, customOp?: string, customVal?: string): string {
  let defaultValMatch = opt.clause.match(/"([^"]*)"/)?.[1];
  if (opt.clause.includes("between")) {
    const betweenMatch = opt.clause.match(/between\s*\(([^)]+)\)/i);
    if (betweenMatch) {
      defaultValMatch = betweenMatch[1];
    }
  } else if (opt.clause.match(/\b(!?in)\s*\(([^)]+)\)/i)) {
    const inMatch = opt.clause.match(/\b(!?in)\s*\(([^)]+)\)/i);
    if (inMatch) {
      defaultValMatch = inMatch[2];
    }
  } else if (opt.clause.match(/\b(!?has)\s*\(([^)]+)\)/i)) {
    const hasMatch = opt.clause.match(/\b(!?has)\s*\(([^)]+)\)/i);
    if (hasMatch) {
      defaultValMatch = hasMatch[2];
    }
  } else {
    const unquotedNumMatch = opt.clause.match(/(==|!=|>=|>|<=|<)\s*([0-9.]+)/);
    if (unquotedNumMatch) {
      defaultValMatch = unquotedNumMatch[2];
    }
  }

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
    : opt.clause.includes(">=")
    ? ">="
    : opt.clause.includes(">")
    ? ">"
    : opt.clause.includes("<=")
    ? "<="
    : opt.clause.includes("<")
    ? "<"
    : opt.clause.includes("!=")
    ? "!="
    : "==";

  const fieldMatch = opt.clause.match(/\|\s*where\s+([^\s=!<]+)/i);
  const field = fieldMatch ? fieldMatch[1].trim() : opt.label.split(" ")[0].trim();

  const op = customOp || defaultOp;
  const rawVal = customVal !== undefined ? customVal : (defaultValMatch ?? "");

  if (op === "between") {
    const cleanedVal = rawVal.replace(/^\(|\)$/g, "").trim();
    return `| where ${field} between (${cleanedVal || "400 .. 599"})`;
  }
  if (op === "in" || op === "!in") {
    const trimmedVal = rawVal.trim();
    if (trimmedVal.startsWith("(") && trimmedVal.endsWith(")")) {
      return `| where ${field} ${op} ${trimmedVal}`;
    }
    return `| where ${field} ${op} (${trimmedVal || "502,403,404,504"})`;
  }
  if (op === "has" || op === "!has") {
    const trimmedVal = rawVal.trim();
    if (trimmedVal.startsWith("(") && trimmedVal.endsWith(")")) {
      return `| where ${field} ${op} ${trimmedVal}`;
    }
    if (trimmedVal.startsWith('"') || trimmedVal.startsWith("'")) {
      return `| where ${field} ${op} ${trimmedVal}`;
    }
    return `| where ${field} ${op} (${trimmedVal || "'400','500'"})`;
  }
  if (op === "!contains") {
    return `| where ${field} !contains "${rawVal}"`;
  }
  if (op === "contains") {
    return `| where ${field} contains "${rawVal}"`;
  }

  const isNumeric = isNumericFieldOrOp(field, op, rawVal);
  if (isNumeric) {
    const numericVal = rawVal.trim() !== "" ? rawVal.trim() : "0";
    return `| where ${field} ${op} ${numericVal}`;
  }

  return `| where ${field} ${op} "${rawVal}"`;
}
