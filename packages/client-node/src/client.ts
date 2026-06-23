import type { DataFormat, IsSame, QueryParamsWithFormat } from "./common/index";
import { ClickHouseClient } from "./common/index";
import type Stream from "stream";
import type { NodeClickHouseClientConfigOptions } from "./config";
import { NodeConfigImpl } from "./config";
import type { ResultSet } from "./result_set";

/** If the Format is not a literal type, fall back to the default behavior of the ResultSet,
 *  allowing to call all methods with all data shapes variants,
 *  and avoiding generated types that include all possible DataFormat literal values. */
export type QueryResult<Format extends DataFormat> =
  IsSame<Format, DataFormat> extends true
    ? ResultSet<unknown>
    : ResultSet<Format>;

export class NodeClickHouseClient extends ClickHouseClient<Stream.Readable> {
  /** See {@link ClickHouseClient.query}. */
  override query<Format extends DataFormat = "JSON">(
    params: QueryParamsWithFormat<Format>,
  ): Promise<QueryResult<Format>> {
    return super.query(params) as Promise<ResultSet<Format>>;
  }
}

export function createClient(
  config?: NodeClickHouseClientConfigOptions,
): NodeClickHouseClient {
  // If the caller injected a pre-built Connection (pluggable-backend path
  // — see NodeClickHouseClientConfigOptions.connection), override the
  // default HTTP make_connection factory to return THAT connection
  // instead. The factory is invoked with (config, params) by the shared
  // Client; we ignore both because the injected connection is already
  // fully built by its own factory (e.g.
  // `createChdbConnection({ path: ':memory:' })`).
  const injected = config?.connection;
  const impl =
    injected !== undefined
      ? { ...NodeConfigImpl, make_connection: () => injected }
      : NodeConfigImpl;
  return new ClickHouseClient<Stream.Readable>({
    impl,
    ...(config || {}),
  }) as NodeClickHouseClient;
}
