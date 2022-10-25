import type Stream from 'stream'
import type { Logger } from '../logger'
import { HttpAdapter, HttpsAdapter } from './adapter'
import type { ClickHouseSettings } from '../settings'

export interface ConnectionParams {
  url: URL

  connect_timeout: number
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
}

export interface InsertParams extends BaseParams {
  values: string | Stream.Readable
}

export interface Connection {
  ping(): Promise<boolean>
  close(): Promise<void>
  query(params: BaseParams): Promise<Stream.Readable>
  exec(params: BaseParams): Promise<Stream.Readable>
  insert(params: InsertParams): Promise<void>
}

export function createConnection(
  params: ConnectionParams,
  logger: Logger
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
