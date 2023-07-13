import type {
  BaseClickHouseClientConfigOptions,
  InsertParams,
} from '@clickhouse/client-common/client'
import { ClickHouseClient } from '@clickhouse/client-common/client'
import { BrowserConnection } from './connection'
import { BrowserValuesEncoder } from './utils'
import { ResultSet } from './result_set'
import type {
  ConnectionParams,
  InsertResult,
} from '@clickhouse/client-common/connection'
import type {
  DataFormat,
  InputJSON,
  InputJSONObjectEachRow,
} from '@clickhouse/client-common'

export type BrowserClickHouseClient = Omit<
  ClickHouseClient<ReadableStream>,
  'insert'
> & {
  insert<T>( // patch insert to restrict ReadableStream as a possible insert value
    params: Omit<InsertParams<ReadableStream, T>, 'values'> & {
      values: ReadonlyArray<T> | InputJSON<T> | InputJSONObjectEachRow<T>
    }
  ): Promise<InsertResult>
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
