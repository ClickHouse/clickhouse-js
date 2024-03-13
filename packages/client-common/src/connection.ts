import type { WithClickHouseSummary } from './clickhouse_types'
import type { LogWriter } from './logger'
import type { ClickHouseSettings } from './settings'

export interface ConnectionParams {
  url: URL
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
  log_writer: LogWriter
  application_id?: string
  additional_headers?: Record<string, string>
}

export interface ConnBaseQueryParams {
  query: string
  clickhouse_settings?: ClickHouseSettings
  query_params?: Record<string, unknown>
  abort_signal?: AbortSignal
  session_id?: string
  query_id?: string
}

export interface ConnInsertParams<Stream> extends ConnBaseQueryParams {
  values: string | Stream
}

export interface ConnBaseResult {
  query_id: string
}

export interface ConnQueryResult<Stream> extends ConnBaseResult {
  stream: Stream
  query_id: string
}

export type ConnInsertResult = ConnBaseResult & WithClickHouseSummary
export type ConnExecResult<Stream> = ConnQueryResult<Stream> &
  WithClickHouseSummary

export type ConnPingResult =
  | {
      success: true
    }
  | { success: false; error: Error }

export type ConnOperation = 'Ping' | 'Query' | 'Insert' | 'Exec'

export interface Connection<Stream> {
  ping(): Promise<ConnPingResult>
  close(): Promise<void>
  query(params: ConnBaseQueryParams): Promise<ConnQueryResult<Stream>>
  exec(params: ConnBaseQueryParams): Promise<ConnExecResult<Stream>>
  insert(params: ConnInsertParams<Stream>): Promise<ConnInsertResult>
}
