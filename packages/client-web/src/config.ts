import type {
  BaseClickHouseClientConfigOptions,
  ConnectionParams,
  DataFormat,
  ImplementationDetails,
  JSONHandling,
  ResponseHeaders,
} from '@clickhouse/client-common'
import { WebConnection } from './connection'
import { ResultSet } from './result_set'
import { WebValuesEncoder } from './utils'

export type WebClickHouseClientConfigOptions =
  BaseClickHouseClientConfigOptions & {
    /** A custom implementation or wrapper over the global `fetch` method that will be used by the client internally.
     *  This might be helpful if you want to configure mTLS or change other default `fetch` settings. */
    fetch?: typeof fetch
  }

export const WebImpl: ImplementationDetails<ReadableStream>['impl'] = {
  make_connection: (
    config: WebClickHouseClientConfigOptions,
    params: ConnectionParams,
  ) =>
    new WebConnection({
      ...params,
      fetch: config.fetch,
    }),
  make_result_set: ((
    stream: ReadableStream,
    format: DataFormat,
    query_id: string,
    _log_error: (err: Error) => void,
    response_headers: ResponseHeaders,
  ) => new ResultSet(stream, format, query_id, response_headers)) as any,
  values_encoder: (jsonHandling: JSONHandling) =>
    new WebValuesEncoder(jsonHandling),
}
