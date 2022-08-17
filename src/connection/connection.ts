import Stream from 'stream'
import type { Logger } from '../logger'
import { HttpAdapter, HttpsAdapter } from './adapter'
import { ClickHouseSettings } from '../settings'

export interface ConnectionParams {
  host: URL

  connect_timeout: number
  request_timeout: number

  compression: {
    decompress_response: boolean
    compress_request: boolean
  }
  // max_open_connections: number;

  username: string
  password: string
  database: string
}

export interface BaseParams {
  query: string
  clickhouse_settings?: ClickHouseSettings
  query_params?: Record<string, unknown>
  abort_signal?: AbortSignal
}

export interface InsertParams extends BaseParams {
  values: string | Stream.Readable
}

export interface Connection {
  ping(): Promise<boolean>
  close(): Promise<void>
  select(params: BaseParams): Promise<Stream.Readable>
  command(params: BaseParams): Promise<Stream.Readable>
  insert(params: InsertParams): Promise<void>
}

export function createConnection(
  config: ConnectionParams,
  logger: Logger
): Connection {
  // TODO throw ClickHouseClient error
  const url = new URL(config.host)
  switch (url.protocol) {
    case 'http:':
      return new HttpAdapter(config, logger)
    case 'https:':
      return new HttpsAdapter(config, logger)
    default:
      throw new Error('Only HTTP(s) adapters are supported')
  }
}
