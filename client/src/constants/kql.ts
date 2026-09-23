export const VALID_KQL_OPERATORS = new Set([
  "where",
  "project",
  "extend",
  "summarize",
  "order",
  "sort",
  "take",
  "limit",
  "count",
  "distinct",
  "render",
  "top",
  "join",
  "lookup",
  "union",
  "parse",
  "evaluate",
  "mv-expand",
  "facet",
  "reduce",
  "sample",
  "serialize"
]);

export const BASE_KQL_SUGGESTIONS: {
  label: string;
  detail: string;
  type: "command" | "function" | "operator" | "keyword" | "table";
}[] = [
  { label: "where", detail: "Filter rows by predicate condition", type: "command" },
  { label: "project", detail: "Select columns to include in result", type: "command" },
  { label: "extend", detail: "Create calculated columns", type: "command" },
  { label: "summarize", detail: "Aggregate data by group columns", type: "command" },
  { label: "order by", detail: "Sort rows by column(s)", type: "command" },
  { label: "sort by", detail: "Sort rows by column(s)", type: "command" },
  { label: "take 100", detail: "Return first 100 rows", type: "command" },
  { label: "limit 100", detail: "Limit result to 100 rows", type: "command" },
  { label: "distinct", detail: "Select distinct values of column", type: "command" },
  { label: "count()", detail: "Count total row count", type: "function" },
  { label: "case()", detail: "case(cond1, val1, cond2, val2, defaultVal)", type: "function" },
  { label: "extract()", detail: "extract(regexPattern, group, stringField)", type: "function" },
  { label: "tostring()", detail: "Convert expression to string", type: "function" },
  { label: "toint()", detail: "Convert expression to integer", type: "function" },
  { label: "split()", detail: "Split string into dynamic array by delimiter", type: "function" },
  { label: "ago()", detail: "Subtract relative timespan ago(24h)", type: "function" },

  // Specific condition expressions
  { label: "between (400 .. 599)", detail: "HTTP status code range filter", type: "operator" },
  { label: "!in ( 502,403,404,504 )", detail: "Exclude HTTP error codes set", type: "operator" },
  { label: "in ( 502,403,404,504 )", detail: "Filter HTTP error codes set", type: "operator" },
  { label: "has ('400','500')", detail: "Filter matching status terms set", type: "operator" },
  { label: "!has ('400','500')", detail: "Exclude matching status terms set", type: "operator" },

  // Standard KQL binary operators
  { label: "between", detail: "Range check between (min .. max)", type: "operator" },
  { label: "in", detail: "In set operator in (val1, val2, ...)", type: "operator" },
  { label: "!in", detail: "Not in set operator !in (val1, val2, ...)", type: "operator" },
  { label: "has", detail: "Indexed term match operator", type: "operator" },
  { label: "!has", detail: "Exclude indexed term match operator", type: "operator" },
  { label: "has_any", detail: "Match any term: has_any ('val1', 'val2')", type: "operator" },
  { label: "has_all", detail: "Match all terms: has_all ('val1', 'val2')", type: "operator" },
  { label: "contains", detail: "Case-insensitive substring match", type: "operator" },
  { label: "!contains", detail: "Case-insensitive does not contain", type: "operator" },
  { label: "startswith", detail: "String prefix match", type: "operator" },
  { label: "endswith", detail: "String suffix match", type: "operator" },
  { label: "and", detail: "Logical AND operator", type: "operator" },
  { label: "or", detail: "Logical OR operator", type: "operator" },
  { label: "desc", detail: "Descending sort order", type: "keyword" },
  { label: "asc", detail: "Ascending sort order", type: "keyword" },
  { label: "StorageFileLogs", detail: "Azure Storage File shares log table", type: "table" },
  { label: "StorageBlobLogs", detail: "Azure Storage Blob log table", type: "table" },
  { label: "AzureDiagnostics", detail: "Azure Diagnostics log table", type: "table" },
  { label: "KubeEvents", detail: "Kubernetes cluster events table", type: "table" },
  { label: "AppRequests", detail: "Application Insights requests log", type: "table" }
];
