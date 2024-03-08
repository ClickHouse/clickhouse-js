import type {
  DataFormat,
  ImplementationDetails,
} from '@clickhouse/client-common'
import {
  type BaseClickHouseClientConfigOptions,
  booleanConfigURLValue,
  type ConnectionParams,
  numberConfigURLValue,
} from '@clickhouse/client-common'
import type Stream from 'stream'
import { createConnection, type TLSParams } from './connection'
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

export const NodeConfigImpl: Required<
  ImplementationDetails<Stream.Readable>['impl']
> = {
  handle_specific_url_params: (config, url) => {
    const nodeConfig: NodeClickHouseClientConfigOptions = { ...config }
    const unknownParams = new Set<string>()
    const handledParams = new Set<string>()
    const urlSearchParamsKeys = [...url.searchParams.keys()]
    if (urlSearchParamsKeys.length > 0) {
      urlSearchParamsKeys.forEach((key) => {
        const value = url.searchParams.get(key) as string
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
  make_connection: (
    nodeConfig: NodeClickHouseClientConfigOptions,
    params: ConnectionParams
  ) => {
    let tls: TLSParams | undefined = undefined
    if (nodeConfig.tls !== undefined) {
      if ('cert' in nodeConfig.tls && 'key' in nodeConfig.tls) {
        tls = {
          type: 'Mutual',
          ...nodeConfig.tls,
        }
      } else {
        tls = {
          type: 'Basic',
          ...nodeConfig.tls,
        }
      }
    }
    const keep_alive = {
      enabled: nodeConfig?.keep_alive?.enabled ?? true,
      socket_ttl: nodeConfig?.keep_alive?.socket_ttl ?? 2500,
      retry_on_expired_socket:
        nodeConfig?.keep_alive?.retry_on_expired_socket ?? false,
    }
    return createConnection(params, tls, keep_alive)
  },
  values_encoder: new NodeValuesEncoder(),
  make_result_set: ((
    stream: Stream.Readable,
    format: DataFormat,
    query_id: string
  ) => new ResultSet(stream, format, query_id)) as any, // FIXME: resolve weird type issue - the types actually match
  close_stream: async (stream) => {
    stream.destroy()
  },
}
