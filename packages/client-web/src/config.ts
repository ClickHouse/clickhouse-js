import type {
  BaseClickHouseClientConfigOptions,
  ConnectionParams,
  DataFormat,
  ImplementationDetails,
  ResponseHeaders,
} from '@clickhouse/client-common'
import { WebConnection } from './connection'
import { ResultSet } from './result_set'
import { WebValuesEncoder } from './utils'

export type WebClickHouseClientConfigOptions =
  BaseClickHouseClientConfigOptions & {
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
  values_encoder: new WebValuesEncoder(),
}
