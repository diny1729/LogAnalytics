import type { AzureWorkspace } from "./api";

export type FilterOperator = "==" | "!=" | "contains" | "!contains" | "<" | "<=" | ">" | ">=";

export type ParsedFilter = {
  id: string;
  field: string;
  operator: string;
  value: string;
  expression: string;
  enabled: boolean;
};

export type QueryTable = {
  name: string;
  columns: Array<{
    name: string;
    type: string;
  }>;
  rows: unknown[][];
};

export type QueryResponse = {
  tables: QueryTable[];
  effectiveQuery: string;
  partialError?: string;
  statistics?: unknown;
};

export type PresetOption = {
  label: string;
  clause: string;
  group?: string;
  isCustomInput?: boolean;
};

export type DynamicFilterDef = {
  field: string;
  label: string;
  clauseTemplate: (selectedValues: string | string[]) => string;
};

export type PresetQuery = {
  id: string;
  name: string;
  description: string;
  baseQuery: string;
  options: PresetOption[];
  projectColumns: string[];
  dynamicFilters?: DynamicFilterDef[];
};

export type TabState = {
  id: string;
  title: string;
  query: string;
  timespan: string;
  maxRows: number;
  workspaceId: string;
  selectedSubscription?: string;
  result: QueryResponse | null;
  loading: boolean;
  error: string | null;
  activePreset: PresetQuery | null;
  presetOptions: Set<string>;
  presetProjectColumns: Set<string>;
  dynamicFilterValues: Record<string, string[]>;
  selectedDynamicFilters: Record<string, string[]>;
  filterSearch: Record<string, string>;
  optionOperators: Record<string, string>;
  optionValues: Record<string, string>;
  customStart: string;
  customEnd: string;
  isCustomInputMode: boolean;
};

export type KqlSyntaxError = {
  line: number;
  message: string;
  suggestion?: string;
  token?: string;
};

export type { ThemeMode, ThemeConfig } from "./constants/themes";
