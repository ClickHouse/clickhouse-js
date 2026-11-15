import type {
  CommandParams as BaseCommandParams,
  CommandResult,
  DataFormat,
  ExecParams as BaseExecParams,
  ExecResult,
  ExternalDataEntry as BaseExternalDataEntry,
  ExternalDataInput as BaseExternalDataInput,
  InputJSON,
  InputJSONObjectEachRow,
  InsertParams,
  InsertResult,
  IsSame,
  QueryParams as BaseQueryParamsWithExternal,
  QueryParamsWithFormat as BaseQueryParamsWithFormat,
} from "./common/index";
import { ClickHouseClient } from "./common/index";
import type { WebClickHouseClientConfigOptions } from "./config";
import { WebImpl } from "./config";
import type { ResultSet } from "./result_set";

/**
 * Payload of an {@link ExternalDataEntry} in `@clickhouse/client-web`.
 * `ReadableStream` is excluded until streaming request bodies are supported
 * across major web platforms (matching `insert()`).
 */
export type ExternalDataInput = BaseExternalDataInput<never>;
export type ExternalDataEntry = BaseExternalDataEntry<never>;
export type QueryParams = BaseQueryParamsWithExternal<never>;
export type QueryParamsWithFormat<Format extends DataFormat> =
  BaseQueryParamsWithFormat<Format, never>;
export type ExecParams = Omit<BaseExecParams<never>, "ignore_error_response">;
export type CommandParams = Omit<
  BaseCommandParams<never>,
  "ignore_error_response"
>;

/** If the Format is not a literal type, fall back to the default behavior of the ResultSet,
 *  allowing to call all methods with all data shapes variants,
 *  and avoiding generated types that include all possible DataFormat literal values. */
export type QueryResult<Format extends DataFormat> =
  IsSame<Format, DataFormat> extends true
    ? ResultSet<unknown>
    : ResultSet<Format>;

export type WebClickHouseClient = Omit<
  WebClickHouseClientImpl,
  "query" | "insert" | "exec" | "command"
> & {
  /** See {@link ClickHouseClient.query}.
   *
   *  `ReadableStream` is excluded from `external_data` inputs on the Web client
   *  until streaming request bodies are supported across major web platforms. */
  query<Format extends DataFormat = "JSON">(
    params: QueryParamsWithFormat<Format>,
  ): Promise<QueryResult<Format>>;
  /** See {@link ClickHouseClient.insert}.
   *
   *  ReadableStream is removed from possible insert values
   *  until it is supported by all major web platforms. */
  insert<T>(
    params: Omit<InsertParams<ReadableStream, T>, "values"> & {
      values: ReadonlyArray<T> | InputJSON<T> | InputJSONObjectEachRow<T>;
    },
  ): Promise<InsertResult>;
  /** See {@link ClickHouseClient.exec}.
   *
   *  Custom values are currently not supported in the web versions.
   *  The `ignore_error_response` parameter is not supported in the Web version. */
  exec(params: ExecParams): Promise<ExecResult<ReadableStream>>;
  /** See {@link ClickHouseClient.command}.
   *
   *  The `ignore_error_response` parameter is not supported in the Web version. */
  command(params: CommandParams): Promise<CommandResult>;
};

class WebClickHouseClientImpl extends ClickHouseClient<ReadableStream> {
  /** See {@link ClickHouseClient.query}. */
  override query<Format extends DataFormat = "JSON">(
    params: BaseQueryParamsWithFormat<Format, ReadableStream>,
  ): Promise<QueryResult<Format>> {
    return super.query(params) as Promise<ResultSet<Format>>;
  }
}

export function createClient(
  config?: WebClickHouseClientConfigOptions,
): WebClickHouseClient {
  return new WebClickHouseClientImpl({
    impl: WebImpl,
    ...(config || {}),
  });
}
