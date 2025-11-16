import type {
  DataFormat,
  ImplementationDetails,
  JSONHandling,
  ResponseHeaders,
} from '@clickhouse/client-common'
import {
  type BaseClickHouseClientConfigOptions,
  type ConnectionParams,
  numberConfigURLValue,
} from '@clickhouse/client-common'
import type http from 'http'
import type https from 'node:https'
import type Stream from 'stream'
import { NodeConnectionFactory, type TLSParams } from './connection'
import { ResultSet } from './result_set'
import { NodeValuesEncoder } from './utils'

export type NodeClickHouseClientConfigOptions =
  BaseClickHouseClientConfigOptions & {
    tls?: BasicTLSOptions | MutualTLSOptions
    /** HTTP Keep-Alive related settings */
    keep_alive?: {
      /** Enable or disable the HTTP Keep-Alive mechanism.
       *  @default true */
      enabled?: boolean
      /** For how long keep a particular idle socket alive on the client side (in milliseconds).
       *  It is supposed to be a fair bit less that the ClickHouse server KeepAlive timeout,
       *  which is by default 3000 ms for pre-23.11 versions. <br/>
       *  When set to `0`, the idle socket management feature is disabled.
       *  @default 2500 */
      idle_socket_ttl?: number
    }
    /** Custom HTTP agent to use for the outgoing HTTP(s) requests.
     *  If set, {@link BaseClickHouseClientConfigOptions.max_open_connections}, {@link tls} and {@link keep_alive}
     *  options have no effect, as it is part of the default underlying agent configuration.
     *  @experimental - unstable API; it might be a subject to change in the future;
     *                  please provide your feedback in the repository.
     *  @default undefined */
    http_agent?: http.Agent | https.Agent
    /** Enable or disable the `Authorization` header with basic auth for the outgoing HTTP(s) requests.
     *  @experimental - unstable API; it might be a subject to change in the future;
     *                  please provide your feedback in the repository.
     *  @default true (enabled) */
    set_basic_auth_header?: boolean
    /** You could try enabling this option if you encounter an error with an unclear or truncated stack trace;
     *  as it might happen due to the way the Node.js handles the stack traces in the async code.
     *  Note that it might have a noticeable performance impact due to
     *  capturing the full stack trace on each client method call.
     *  It could also be necessary to override `Error.stackTraceLimit` and increase it
     *  to a higher value, or even to `Infinity`, as the default value Node.js is just `10`.
     *  @experimental - unstable API; it might be a subject to change in the future;
     *                  please provide your feedback in the repository.
     *  @default false (disabled) */
    capture_enhanced_stack_trace?: boolean
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
    return NodeConnectionFactory.create({
      connection_params: params,
      set_basic_auth_header: nodeConfig.set_basic_auth_header ?? true,
      capture_enhanced_stack_trace:
        nodeConfig.capture_enhanced_stack_trace ?? false,
      http_agent: nodeConfig.http_agent,
      keep_alive,
      tls,
    })
  },
  values_encoder: (jsonHandling: JSONHandling) =>
    new NodeValuesEncoder(jsonHandling),
  make_result_set: ((
    stream: Stream.Readable,
    format: DataFormat,
    query_id: string,
    log_error: (err: Error) => void,
    response_headers: ResponseHeaders,
    jsonHandling: JSONHandling,
  ) =>
    ResultSet.instance({
      stream,
      format,
      query_id,
      log_error,
      response_headers,
      jsonHandling,
    })) as any,
}
