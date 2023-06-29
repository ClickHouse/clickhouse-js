import type Stream from 'stream'
import type { LogWriter } from '../logger'
import { HttpAdapter, HttpsAdapter } from './adapter'
import type { ClickHouseSettings } from '../settings'

export interface ConnectionParams {
  url: URL

  application_id?: string

  request_timeout: number
  max_open_connections: number

  compression: {
    decompress_response: boolean
    compress_request: boolean
  }

  tls?: TLSParams

  username: string
  password: string
  database: string

  keep_alive: {
    enabled: boolean
    socket_ttl: number
    retry_on_expired_socket: boolean
  }
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

export interface BaseParams {
  query: string
  clickhouse_settings?: ClickHouseSettings
  query_params?: Record<string, unknown>
  abort_signal?: AbortSignal
  session_id?: string
  query_id?: string
}

export interface InsertParams extends BaseParams {
  values: string | Stream.Readable
}

export type QueryParams = BaseParams
export type ExecParams = BaseParams

export interface BaseResult {
  query_id: string
}

export interface QueryResult extends BaseResult {
  stream: Stream.Readable
  query_id: string
}

export type InsertResult = BaseResult
export type ExecResult = QueryResult

export interface Connection {
  ping(): Promise<boolean>
  close(): Promise<void>
  query(params: QueryParams): Promise<QueryResult>
  exec(params: ExecParams): Promise<ExecResult>
  insert(params: InsertParams): Promise<InsertResult>
}

export function createConnection(
  params: ConnectionParams,
  logger: LogWriter
): Connection {
  // TODO throw ClickHouseClient error
  switch (params.url.protocol) {
    case 'http:':
      return new HttpAdapter(params, logger)
    case 'https:':
      return new HttpsAdapter(params, logger)
    default:
      throw new Error('Only HTTP(s) adapters are supported')
  }
}
