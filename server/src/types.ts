export type ParsedFilter = {
  id: string;
  field: string;
  operator: string;
  value: string;
  expression: string;
  enabled: boolean;
  start: number;
  end: number;
};

export type FilterSelection = {
  id: string;
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
  partialError?: string;
  statistics?: unknown;
};
