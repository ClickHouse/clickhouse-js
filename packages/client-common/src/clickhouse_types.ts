/**
 * When you call {@link ResultSet.json}, this is the output type for the following ClickHouse single-document JSON data formats:
 *
 * - JSON
 * - JSONStrings
 * - JSONCompact
 * - JSONColumnsWithMetadata
 * - JSONCompactStrings
 *
 * NB: don't confuse ClickHouse JSON data format (https://clickhouse.com/docs/en/interfaces/formats#json) with the general JSON format.
 *
 * JSONEachRow and other JSON*EachRow formats (except JSONObjectEachRow) are represented as an array of objects in the response and can be streamed by the client.
 */
export interface ResponseJSON<T = unknown> {
  data: Array<T>
  query_id?: string
  totals?: Record<string, number>
  extremes?: Record<string, any>
  // Supported only by responses in JSON, XML. Otherwise, it can be read from X-ClickHouse-Summary header
  meta?: Array<{ name: string; type: string }>
  statistics?: { elapsed: number; rows_read: number; bytes_read: number }
  rows?: number
}

/**
 * Input type for the following ClickHouse single-document JSON data formats:
 *
 * - JSON
 * - JSONCompact
 * - JSONColumnsWithMetadata
 *
 * JSONStrings and JSONCompactStrings are not supported for input.
 */
export interface InputJSON<T = unknown> {
  meta: { name: string; type: string }[]
  data: T[]
}

/** JSONObjectEachRow format input */
export type InputJSONObjectEachRow<T = unknown> = Record<string, T>

/** X-ClickHouse-Summary header values.
 *  See also: https://clickhouse.com/docs/en/interfaces/http */
export interface ClickHouseSummary {
  read_rows: string
  read_bytes: string
  written_rows: string
  written_bytes: string
  total_rows_to_read: string
  result_rows: string
  result_bytes: string
  elapsed_ns: string
}

export interface WithClickHouseSummary {
  summary?: ClickHouseSummary
}
