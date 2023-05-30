import type { LogWriter } from './logger'
import type { ClickHouseSettings } from './settings'

export interface ConnectionParams {
  url: URL
  connect_timeout: number
  request_timeout: number
  max_open_connections: number
  compression: {
    decompress_response: boolean
    compress_request: boolean
  }
  username: string
  password: string
  database: string
  clickhouse_settings: ClickHouseSettings
  logWriter: LogWriter
  session_id?: string
  application_id?: string
}

export interface BaseQueryParams {
  query: string
  clickhouse_settings?: ClickHouseSettings
  query_params?: Record<string, unknown>
  abort_signal?: AbortSignal
  session_id?: string
  query_id?: string
}

export interface InsertParams<Stream> extends BaseQueryParams {
  values: string | Stream
}

export interface QueryResult<Stream> {
  stream: Stream
  query_id: string
}

export interface InsertResult {
  query_id: string
}

export interface Connection<Stream> {
  ping(): Promise<boolean>
  close(): Promise<void>
  query(params: BaseQueryParams): Promise<QueryResult<Stream>>
  exec(params: BaseQueryParams): Promise<QueryResult<Stream>>
  insert(params: InsertParams<Stream>): Promise<InsertResult>
}
