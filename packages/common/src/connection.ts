import type { ClickHouseSettings } from 'client-common/src/settings'
import type Stream from 'stream'
import type { LogWriter } from './logger'

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
  tls?: TLSParams
}

export type TLSParams =
  | {
      ca_cert: Buffer
      type: 'Basic'
    }
  | {
      ca_cert: Buffer
      cert: Buffer
      key: Buffer
      type: 'Mutual'
    }

export interface BaseQueryParams {
  query: string
  clickhouse_settings?: ClickHouseSettings
  query_params?: Record<string, unknown>
  abort_signal?: AbortSignal
  session_id?: string
  query_id?: string
}

export interface InsertParams extends BaseQueryParams {
  values: string | Stream.Readable
}

export interface QueryResult {
  stream: Stream.Readable
  query_id: string
}

export interface InsertResult {
  query_id: string
}

export interface Connection {
  ping(): Promise<boolean>
  close(): Promise<void>
  query(params: BaseQueryParams): Promise<QueryResult>
  exec(params: BaseQueryParams): Promise<QueryResult>
  insert(params: InsertParams): Promise<InsertResult>
}
