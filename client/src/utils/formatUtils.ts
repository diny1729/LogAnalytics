import type { QueryTable } from "../types";

export function formatCell(value: unknown, useLocalTime: boolean = true): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  const str = String(value).trim();
  
  // Check if string looks like an ISO date/timestamp (e.g., 2026-07-16T02:18:57Z or with milliseconds/offsets)
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/i.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      if (useLocalTime) {
        return d.toLocaleString();
      } else {
        return d.toLocaleString(undefined, { timeZone: "UTC" });
      }
    }
  }
  return str;
}

export function csvEscape(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function toCsv(columns: QueryTable["columns"], rows: unknown[][], useLocalTime: boolean): string {
  const header = columns.map((column) => csvEscape(column.name)).join(",");
  const body = rows
    .map((row) => row.map((cell) => csvEscape(formatCell(cell, useLocalTime))).join(","))
    .join("\n");
  return `${header}\n${body}`;
}

export function formatIso(year: number, month: number, day: number, hour: number, min: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(min)}`;
}
