import type {
  BaseResultSet,
  InputJSON,
  InputJSONObjectEachRow,
  InsertParams,
  InsertResult,
  QueryParams,
  Row,
} from '@clickhouse/client-common'
import { ClickHouseClient } from '@clickhouse/client-common'
import type { WebClickHouseClientConfigOptions } from './config'
import { WebImpl } from './config'

export type WebClickHouseClient = Omit<
  ClickHouseClient<ReadableStream>,
  'insert' | 'query'
> & {
  // restrict ReadableStream as a possible insert value
  insert<T>(
    params: Omit<InsertParams<ReadableStream, T>, 'values'> & {
      values: ReadonlyArray<T> | InputJSON<T> | InputJSONObjectEachRow<T>
    },
  ): Promise<InsertResult>
  // narrow down the return type here for better type-hinting
  query(params: QueryParams): Promise<BaseResultSet<ReadableStream<Row[]>>>
}

export function createClient(
  config?: WebClickHouseClientConfigOptions,
): WebClickHouseClient {
  return new ClickHouseClient<ReadableStream>({
    impl: WebImpl,
    ...(config || {}),
  })
}
