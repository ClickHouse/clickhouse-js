import type {
  CommandParams,
  CommandResult,
  DataFormat,
  ExecParams,
  ExecResult,
  InputJSON,
  InputJSONObjectEachRow,
  InsertParams,
  InsertResult,
  IsSame,
  QueryParamsWithFormat,
} from '@clickhouse/client-common'
import { ClickHouseClient } from '@clickhouse/client-common'
import type { WebClickHouseClientConfigOptions } from './config'
import { WebImpl } from './config'
import type { ResultSet } from './result_set'

/** If the Format is not a literal type, fall back to the default behavior of the ResultSet,
 *  allowing to call all methods with all data shapes variants,
 *  and avoiding generated types that include all possible DataFormat literal values. */
export type QueryResult<Format extends DataFormat> =
  IsSame<Format, DataFormat> extends true
    ? ResultSet<unknown>
    : ResultSet<Format>

export type WebClickHouseClient = Omit<
  WebClickHouseClientImpl,
  'insert' | 'exec' | 'command'
> & {
  /** See {@link ClickHouseClient.insert}.
   *
   *  ReadableStream is removed from possible insert values
   *  until it is supported by all major web platforms. */
  insert<T>(
    params: Omit<InsertParams<ReadableStream, T>, 'values'> & {
      values: ReadonlyArray<T> | InputJSON<T> | InputJSONObjectEachRow<T>
    },
  ): Promise<InsertResult>
  /** See {@link ClickHouseClient.exec}.
   *
   *  Custom values are currently not supported in the web versions.
   *  The `ignore_error_response` parameter is not supported in the Web version. */
  exec(
    params: Omit<ExecParams, 'ignore_error_response'>,
  ): Promise<ExecResult<ReadableStream>>
  /** See {@link ClickHouseClient.command}.
   *
   *  The `ignore_error_response` parameter is not supported in the Web version. */
  command(
    params: Omit<CommandParams, 'ignore_error_response'>,
  ): Promise<CommandResult>
}

class WebClickHouseClientImpl extends ClickHouseClient<ReadableStream> {
  /** See {@link ClickHouseClient.query}. */
  query<Format extends DataFormat>(
    params: QueryParamsWithFormat<Format>,
  ): Promise<QueryResult<Format>> {
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
