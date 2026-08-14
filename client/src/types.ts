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
