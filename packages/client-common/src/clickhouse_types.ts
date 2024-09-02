export interface ResponseJSON<T = unknown> {
  data: Array<T>
  query_id?: string
  totals?: T
  extremes?: Record<string, any>
  // # Supported only by responses in JSON, XML.
  // # Otherwise, it can be read from x-clickhouse-summary header
  meta?: Array<{ name: string; type: string }>
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
