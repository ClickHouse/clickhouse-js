// TODO add other settings
export type ClickHouseSettings = {
  allow_nondeterministic_mutations?: 0 | 1;
  distributed_product_mode?: 'deny' | 'local' | 'global' | 'allow';
  prefer_global_in_and_join?: 0 | 1;
  enable_optimize_predicate_expression?: 0 | 1;
  extremes?: 0 | 1;
  limit?: number;
};

// TODO list other data types
export type DataType =
  | 'UInt8'
  | 'UInt16'
  | 'UInt32'
  | 'UInt64'
  | 'UInt128'
  | 'UInt256'
  | 'Int8'
  | 'Int16'
  | 'Int32'
  | 'Int64'
  | 'Int128'
  | 'Int256'
  | 'Float32'
  | 'Float64';

export interface ResponseJSON<T = unknown> {
  data: Array<T>;
  // columns: Array<{ name: string; type: DataType; nullable: boolean}>;
  query_id?: string;
  totals?: Record<string, number>;
  extremes?: Record<string, any>;
  // summary?: ResponseSummary
  // # Supported only by responses in JSON, XML. Otherwise it can be read from x-clickhouse-summary header
  meta?: Array<{ name: string; type: DataType }>;
  statistics?: { elapsed: number; rows_read: number; bytes_read: number };
  rows?: number;
}
