import type {
  DataFormat,
  ImplementationDetails,
} from '@clickhouse/client-common'
import {
  type BaseClickHouseClientConfigOptions,
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
      /** Enable or disable HTTP Keep-Alive mechanism.
       *  @default true */
      enabled?: boolean
      /** For how long keep a particular idle socket alive on the client side (in milliseconds).
       *  It is supposed to be a fair bit less that the ClickHouse server KeepAlive timeout,
       *  which is by default 3000 ms for pre-23.11 versions.
       *  @default 2500 */
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
          case 'keep_alive_idle_socket_ttl':
            if (nodeConfig.keep_alive === undefined) {
              nodeConfig.keep_alive = {}
            }
            nodeConfig.keep_alive.idle_socket_ttl = numberConfigURLValue({
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
    params: ConnectionParams,
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
    // normally, it should be already set after processing the config
    const keep_alive = {
      enabled: nodeConfig?.keep_alive?.enabled ?? true,
      idle_socket_ttl: nodeConfig?.keep_alive?.idle_socket_ttl ?? 2500,
    }
    return createConnection(params, tls, keep_alive)
  },
  values_encoder: new NodeValuesEncoder(),
  make_result_set: ((
    stream: Stream.Readable,
    format: DataFormat,
    query_id: string,
    log_error: (err: Error) => void,
  ) =>
    ResultSet.instance({
      stream,
      format,
      query_id,
      log_error,
    })) as any,
}
