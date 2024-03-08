import type {
  BaseClickHouseClientConfigOptions,
  ConnectionParams,
  DataFormat,
  ImplementationDetails,
} from '@clickhouse/client-common'
import { WebConnection } from './connection'
import { ResultSet } from './result_set'
import { WebValuesEncoder } from './utils'

export type WebClickHouseClientConfigOptions = BaseClickHouseClientConfigOptions

export const WebImpl: ImplementationDetails<ReadableStream>['impl'] = {
  make_connection: (_, params: ConnectionParams) => new WebConnection(params),
  make_result_set: ((
    stream: ReadableStream,
    format: DataFormat,
    query_id: string
  ) => new ResultSet(stream, format, query_id)) as any, // FIXME: resolve weird type issue - the types actually match
  values_encoder: new WebValuesEncoder(),
  close_stream: (stream) => stream.cancel(),
}
