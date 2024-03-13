import type {
  BaseClickHouseClientConfigOptions,
  Connection,
  ConnectionParams,
  DataFormat,
} from '@clickhouse/client-common'
import { ClickHouseClient } from '@clickhouse/client-common'
import type Stream from 'stream'
import type { NodeConnectionParams, TLSParams } from './connection'
import { NodeHttpConnection, NodeHttpsConnection } from './connection'
import { ResultSet } from './result_set'
import { NodeValuesEncoder } from './utils'

export type NodeClickHouseClientConfigOptions =
  BaseClickHouseClientConfigOptions<Stream.Readable> & {
    tls?: BasicTLSOptions | MutualTLSOptions
    /** HTTP Keep-Alive related settings */
    keep_alive?: {
      /** Enable or disable HTTP Keep-Alive mechanism. Default: true */
      enabled?: boolean
      /** For how long keep a particular idle socket alive on the client side (in milliseconds).
       * It is supposed to be a fair bit less that the ClickHouse server KeepAlive timeout, which is by default 3000 ms.
       * Default value: 2500 */
      idle_socket_ttl?: number
    }
  }

interface BasicTLSOptions {
  ca_cert: Buffer
}

interface MutualTLSOptions {
  ca_cert: Buffer
  cert: Buffer
  key: Buffer
}

export function createClient(
  config?: NodeClickHouseClientConfigOptions
): ClickHouseClient<Stream.Readable> {
  let tls: TLSParams | undefined = undefined
  if (config?.tls) {
    if ('cert' in config.tls && 'key' in config.tls) {
      tls = {
        type: 'Mutual',
        ...config.tls,
      }
    } else {
      tls = {
        type: 'Basic',
        ...config.tls,
      }
    }
  }
  const keep_alive = {
    enabled: config?.keep_alive?.enabled ?? true,
    idle_socket_ttl: config?.keep_alive?.idle_socket_ttl ?? 2500,
  }
  return new ClickHouseClient({
    impl: {
      make_connection: (params: ConnectionParams) => {
        switch (params.url.protocol) {
          case 'http:':
            return new NodeHttpConnection({ ...params, keep_alive })
          case 'https:':
            return new NodeHttpsConnection({ ...params, tls, keep_alive })
          default:
            throw new Error('Only HTTP(s) adapters are supported')
        }
      },
      make_result_set: (
        stream: Stream.Readable,
        format: DataFormat,
        session_id: string
      ) => new ResultSet(stream, format, session_id),
      values_encoder: new NodeValuesEncoder(),
      close_stream: async (stream) => {
        stream.destroy()
      },
    },
    ...(config || {}),
  })
}

export function createConnection(
  params: NodeConnectionParams
): Connection<Stream.Readable> {
  // TODO throw ClickHouseClient error
  switch (params.url.protocol) {
    case 'http:':
      return new NodeHttpConnection(params)
    case 'https:':
      return new NodeHttpsConnection(params)
    default:
      throw new Error('Only HTTP(s) adapters are supported')
  }
}
