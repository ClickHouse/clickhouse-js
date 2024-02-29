import type {
  BaseClickHouseClientConfigOptions,
  Connection,
  ConnectionParams,
  DataFormat,
} from '@clickhouse/client-common'
import {
  booleanConfigURLValue,
  ClickHouseClient,
  numberConfigURLValue,
} from '@clickhouse/client-common'
import type Stream from 'stream'
import type { NodeConnectionParams, TLSParams } from './connection'
import { NodeHttpConnection, NodeHttpsConnection } from './connection'
import { ResultSet } from './result_set'
import { NodeValuesEncoder } from './utils'

export type NodeClickHouseClientConfigOptions =
  BaseClickHouseClientConfigOptions & {
    tls?: BasicTLSOptions | MutualTLSOptions
    /** HTTP Keep-Alive related settings */
    keep_alive?: {
      /** Enable or disable HTTP Keep-Alive mechanism. Default: true */
      enabled?: boolean
      /** How long to keep a particular open socket alive
       * on the client side (in milliseconds).
       * Should be less than the server setting
       * (see `keep_alive_timeout` in server's `config.xml`).
       * Currently, has no effect if {@link retry_on_expired_socket}
       * is unset or false. Default value: 2500
       * (based on the default ClickHouse server setting, which is 3000) */
      socket_ttl?: number
      /** If the client detects a potentially expired socket based on the
       * {@link socket_ttl}, this socket will be immediately destroyed
       * before sending the request, and this request will be retried
       * with a new socket up to 3 times. Default: false (no retries) */
      retry_on_expired_socket?: boolean
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
    socket_ttl: config?.keep_alive?.socket_ttl ?? 2500,
    retry_on_expired_socket:
      config?.keep_alive?.retry_on_expired_socket ?? false,
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
      handle_extra_url_params: (config, url) => {
        const nodeConfig: NodeClickHouseClientConfigOptions = { ...config }
        const unknownParams = new Set<string>()
        const handledParams = new Set<string>()
        if (url.searchParams.size > 0) {
          url.searchParams.forEach((value, key) => {
            switch (key) {
              case 'keep_alive_retry_on_expired_socket':
                if (nodeConfig.keep_alive === undefined) {
                  nodeConfig.keep_alive = {}
                }
                nodeConfig.keep_alive.retry_on_expired_socket =
                  booleanConfigURLValue({ key, value })
                handledParams.add(key)
                break
              case 'keep_alive_socket_ttl':
                if (nodeConfig.keep_alive === undefined) {
                  nodeConfig.keep_alive = {}
                }
                nodeConfig.keep_alive.socket_ttl = numberConfigURLValue({
                  key,
                  value,
                  min: 0,
                })
                handledParams.add(key)
                break
              default:
                unknownParams.add(key)
            }
          })
        }
        return {
          config: nodeConfig,
          unknown_params: unknownParams,
          handled_params: handledParams,
        }
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
