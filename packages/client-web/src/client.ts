import type {
  DataFormat,
  InputJSON,
  InputJSONObjectEachRow,
  InsertParams,
  InsertResult,
  QueryParamsWithFormat,
} from '@clickhouse/client-common'
import { ClickHouseClient } from '@clickhouse/client-common'
import type { WebClickHouseClientConfigOptions } from './config'
import { WebImpl } from './config'
import type { ResultSet } from './result_set'

export type WebClickHouseClient = Omit<WebClickHouseClientImpl, 'insert'> & {
  /**
   * See the base implementation: {@link ClickHouseClient.insert}
   *
   * ReadableStream is removed from possible insert values
   * until it is supported by all major web platforms */
  insert<T>(
    params: Omit<InsertParams<ReadableStream, T>, 'values'> & {
      values: ReadonlyArray<T> | InputJSON<T> | InputJSONObjectEachRow<T>
    },
  ): Promise<InsertResult>
}

class WebClickHouseClientImpl extends ClickHouseClient<ReadableStream> {
  /** See the base implementation: {@link ClickHouseClient.query} */
  query<Format extends DataFormat>(
    params: QueryParamsWithFormat<Format>,
  ): Promise<ResultSet<Format>> {
    return super.query(params) as Promise<ResultSet<Format>>
  }
}

export function createClient(
  config?: WebClickHouseClientConfigOptions,
): WebClickHouseClient {
  return new WebClickHouseClientImpl({
    impl: WebImpl,
    ...(config || {}),
  })
}
