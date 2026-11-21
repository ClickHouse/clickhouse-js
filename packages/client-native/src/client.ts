import type { DataFormat, IsSame, QueryParamsWithFormat } from "./common/index";
import { ClickHouseClient } from "./common/index";
import type Stream from "stream";
import type { NativeClickHouseClientConfigOptions } from "./config";
import { NativeConfigImpl } from "./config";
import type { ResultSet } from "./result_set";

/** If the Format is not a literal type, fall back to the default behavior of the ResultSet,
 *  allowing to call all methods with all data shapes variants,
 *  and avoiding generated types that include all possible DataFormat literal values. */
export type QueryResult<Format extends DataFormat> =
  IsSame<Format, DataFormat> extends true
    ? ResultSet<unknown>
    : ResultSet<Format>;

export class NativeClickHouseClient extends ClickHouseClient<Stream.Readable> {
  /** See {@link ClickHouseClient.query}. */
  override query<Format extends DataFormat = "JSON">(
    params: QueryParamsWithFormat<Format>,
  ): Promise<QueryResult<Format>> {
    return super.query(params) as Promise<ResultSet<Format>>;
  }
}

/** Creates a client that uses the native TCP protocol of ClickHouse
 *  (port 9000, or 9440 with TLS) instead of the HTTP interface. */
export function createClient(
  config?: NativeClickHouseClientConfigOptions,
): NativeClickHouseClient {
  return new ClickHouseClient<Stream.Readable>({
    impl: NativeConfigImpl,
    ...((config ?? {}) as object),
  }) as NativeClickHouseClient;
}
