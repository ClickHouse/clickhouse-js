export interface ResponseJSON<T = unknown> {
  data: T[]
  query_id?: string
  totals?: T
  extremes?: Record<string, any>
  // # Supported only by responses in JSON, XML.
  // # Otherwise, it can be read from x-clickhouse-summary header
  meta?: { name: string; type: string }[]
  statistics?: { elapsed: number; rows_read: number; bytes_read: number }
  rows?: number
  rows_before_limit_at_least?: number
}

export interface InputJSON<T = unknown> {
  meta: { name: string; type: string }[]
  data: T[]
}

export type InputJSONObjectEachRow<T = unknown> = Record<string, T>

export interface ClickHouseSummary {
  read_rows: string
  read_bytes: string
  written_rows: string
  written_bytes: string
  total_rows_to_read: string
  result_rows: string
  result_bytes: string
  elapsed_ns: string
  /** Available only after ClickHouse 24.9 */
  real_time_microseconds?: string
}

export type ResponseHeaders = Record<string, string | string[] | undefined>

export interface WithClickHouseSummary {
  summary?: ClickHouseSummary
}

export interface WithResponseHeaders {
  response_headers: ResponseHeaders
}

export interface ClickHouseProgress {
  read_rows: string
  read_bytes: string
  elapsed_ns: string
  total_rows_to_read?: string
}

export interface ProgressRow {
  progress: ClickHouseProgress
}

export type SpecialEventRow<T> =
  | { meta: { name: string; type: string }[] }
  | { totals: T }
  | { min: T }
  | { max: T }
  | { rows_before_limit_at_least: number | string }
  | { rows_before_aggregation: number | string }
  | { exception: string }

export type InsertValues<Stream, T = unknown> =
  | readonly T[]
  | Stream
  | InputJSON<T>
  | InputJSONObjectEachRow<T>

export type NonEmptyArray<T> = [T, ...T[]]

export interface ClickHouseCredentialsAuth {
  username?: string
  password?: string
}

/** Supported in ClickHouse Cloud only */
export interface ClickHouseJWTAuth {
  access_token: string
}

export type ClickHouseAuth = ClickHouseCredentialsAuth | ClickHouseJWTAuth

/** Type guard to use with `JSONEachRowWithProgress`, checking if the emitted row is a progress row.
 *  @see https://clickhouse.com/docs/en/interfaces/formats#jsoneachrowwithprogress */
export function isProgressRow(row: unknown): row is ProgressRow {
  return (
    row !== null &&
    typeof row === 'object' &&
    'progress' in row &&
    Object.keys(row).length === 1
  )
}

/** Type guard to use with `JSONEachRowWithProgress`, checking if the emitted row is a row with data.
 *  @see https://clickhouse.com/docs/en/interfaces/formats#jsoneachrowwithprogress */
export function isRow<T>(row: unknown): row is { row: T } {
  return (
    row !== null &&
    typeof row === 'object' &&
    'row' in row &&
    Object.keys(row).length === 1
  )
}

/** Type guard to use with `JSONEachRowWithProgress`, checking if the row contains an exception.
 *  @see https://clickhouse.com/docs/en/interfaces/formats#jsoneachrowwithprogress */
export function isException(row: unknown): row is { exception: string } {
  return (
    row !== null &&
    typeof row === 'object' &&
    'exception' in row &&
    Object.keys(row).length === 1
  )
}
