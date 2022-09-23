export interface ResponseJSON<T = unknown> {
  data: Array<T>
  query_id?: string
  totals?: Record<string, number>
  extremes?: Record<string, any>
  // # Supported only by responses in JSON, XML.
  // # Otherwise, it can be read from x-clickhouse-summary header
  meta?: Array<{ name: string; type: string }>
  statistics?: { elapsed: number; rows_read: number; bytes_read: number }
  rows?: number
}

export interface InputJSON<T = unknown> {
  meta: { name: string; type: string }[]
  data: T[]
}

export type InputJSONObjectEachRow<T = unknown> = Record<string, T>
