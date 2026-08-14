import crypto from "node:crypto";
import type { FilterSelection, ParsedFilter } from "./types.js";

const blockedCommands = /^\s*\.(create|delete|drop|alter|set|ingest)\b/im;
const whereRegex = /\|\s*where\s+([^|]+)/gi;
const predicateRegex =
  /^\s*([A-Za-z_][\w.]*)\s*(==|!=|>=|<=|>|<|contains|has|startswith|endswith|in)\s*(.+?)\s*$/i;

export function assertSafeKql(query: string, maxLength: number): void {
  if (query.length > maxLength) {
    throw new Error(`Query is too long. Maximum length is ${maxLength} characters.`);
  }

  if (blockedCommands.test(query)) {
    throw new Error("Operational KQL commands are blocked by this application.");
  }
}

export function parseFilters(query: string): ParsedFilter[] {
  const filters: ParsedFilter[] = [];
  const matches = [...query.matchAll(whereRegex)];

  for (const match of matches) {
    const whereBody = match[1] ?? "";
    const whereStart = (match.index ?? 0) + match[0].indexOf(whereBody);
    const parts = splitTopLevelAnd(whereBody);

    for (const part of parts) {
      const expression = part.text.trim();
      if (!expression) continue;

      const predicate = expression.match(predicateRegex);
      if (!predicate) continue;

      filters.push({
        id: stableFilterId(expression, whereStart + part.start),
        field: predicate[1],
        operator: predicate[2].toLowerCase(),
        value: predicate[3].trim(),
        expression,
        enabled: true,
        start: whereStart + part.start,
        end: whereStart + part.end
      });
    }
  }

  return filters;
}

export function applyFilterSelections(query: string, selections: FilterSelection[] = []): string {
  const disabled = new Set(selections.filter((filter) => !filter.enabled).map((filter) => filter.id));
  if (disabled.size === 0) return query;

  const filters = parseFilters(query).filter((filter) => disabled.has(filter.id));
  if (filters.length === 0) return query;

  let nextQuery = query;
  for (const filter of filters.sort((a, b) => b.start - a.start)) {
    nextQuery = removeExpressionAt(nextQuery, filter.start, filter.end);
  }

  return cleanupWhereClauses(nextQuery);
}

function splitTopLevelAnd(input: string): Array<{ text: string; start: number; end: number }> {
  const parts: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote && input[index - 1] !== "\\") quote = null;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);

    const maybeAnd = input.slice(index, index + 3);
    const before = input[index - 1];
    const after = input[index + 3];
    if (
      depth === 0 &&
      maybeAnd.toLowerCase() === "and" &&
      isBoundary(before) &&
      isBoundary(after)
    ) {
      parts.push({ text: input.slice(start, index), start, end: index });
      start = index + 3;
      index += 2;
    }
  }

  parts.push({ text: input.slice(start), start, end: input.length });
  return parts;
}

function removeExpressionAt(query: string, start: number, end: number): string {
  let removeStart = start;
  let removeEnd = end;
  const before = query.slice(0, start);
  const after = query.slice(end);

  const trailingAnd = after.match(/^\s+and\s+/i);
  if (trailingAnd) {
    removeEnd += trailingAnd[0].length;
  } else {
    const leadingAnd = before.match(/\s+and\s+$/i);
    if (leadingAnd) removeStart -= leadingAnd[0].length;
  }

  return `${query.slice(0, removeStart)}${query.slice(removeEnd)}`;
}

function cleanupWhereClauses(query: string): string {
  return query
    .replace(/\|\s*where\s*(?=\||$)/gi, "")
    .replace(/\|\s*where\s*\n\s*(?=\|)/gi, "")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function stableFilterId(expression: string, offset: number): string {
  return crypto.createHash("sha256").update(`${offset}:${expression}`).digest("hex").slice(0, 16);
}

function isBoundary(value: string | undefined): boolean {
  return value === undefined || !/[A-Za-z0-9_]/.test(value);
}
