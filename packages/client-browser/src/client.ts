import type {
  BaseClickHouseClientConfigOptions,
  ConnectionParams,
  DataFormat,
  InputJSON,
  InputJSONObjectEachRow,
  InsertParams,
  InsertResult,
  BaseResultSet,
  QueryParams,
  Row,
} from '@clickhouse/client-common'
import { ClickHouseClient } from '@clickhouse/client-common'
import { BrowserConnection } from './connection'
import { ResultSet } from './result_set'
import { BrowserValuesEncoder } from './utils'

export type BrowserClickHouseClient = Omit<
  ClickHouseClient<ReadableStream>,
  'insert' | 'query'
> & {
  // restrict ReadableStream as a possible insert value
  insert<T>(
    params: Omit<InsertParams<ReadableStream, T>, 'values'> & {
      values: ReadonlyArray<T> | InputJSON<T> | InputJSONObjectEachRow<T>
    }
  ): Promise<InsertResult>
  // narrow down the return type here for better type-hinting
  query(params: QueryParams): Promise<BaseResultSet<ReadableStream<Row[]>>>
}

export function createClient(
  config?: BaseClickHouseClientConfigOptions<ReadableStream>
): BrowserClickHouseClient {
  return new ClickHouseClient<ReadableStream>({
    impl: {
      make_connection: (params: ConnectionParams) =>
        new BrowserConnection(params),
      make_result_set: (
        stream: ReadableStream,
        format: DataFormat,
        query_id: string
      ) => new ResultSet(stream, format, query_id),
      values_encoder: new BrowserValuesEncoder(),
      close_stream: (stream) => stream.cancel(),
    },
    ...(config || {}),
  })
}
