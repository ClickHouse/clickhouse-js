import type {
  DataFormat,
  IsSame,
  QueryParams,
  QueryParamsWithFormat,
} from '@clickhouse/client-common'
import { ClickHouseClient } from '@clickhouse/client-common'
import type Stream from 'stream'
import type { NodeClickHouseClientConfigOptions } from './config'
import { NodeConfigImpl } from './config'
import type {
  QueryNativeColumnsResult,
  QueryNativeRowsResult,
} from './native_query'
import {
  appendFormatNative,
  chunksToRowArrays,
  chunksToRowObjects,
  decodeNativeStream,
  loadAddon,
} from './native_query'
import type { ResultSet } from './result_set'

/** If the Format is not a literal type, fall back to the default behavior of the ResultSet,
 *  allowing to call all methods with all data shapes variants,
 *  and avoiding generated types that include all possible DataFormat literal values. */
export type QueryResult<Format extends DataFormat> =
  IsSame<Format, DataFormat> extends true
    ? ResultSet<unknown>
    : ResultSet<Format>

export class NodeClickHouseClient extends ClickHouseClient<Stream.Readable> {
  /** See {@link ClickHouseClient.query}. */
  query<Format extends DataFormat = 'JSON'>(
    params: QueryParamsWithFormat<Format>,
  ): Promise<QueryResult<Format>> {
    return super.query(params) as Promise<ResultSet<Format>>
  }

  /**
   * Fetches the result as `FORMAT Native` through the regular transport stack
   * and decodes it via the Rust `ch-core` addon into zero-copy TypedArray
   * columns, grouped in chunks (one per Native block).
   *
   * The query must not contain a FORMAT clause; it is appended internally.
   *
   * @experimental POC — API shape and packaging will change; requires the
   * ch-core-js addon to be built (or CH_CORE_JS_ADDON_PATH to point at it).
   */
  async queryNativeColumns(
    params: Omit<QueryParams, 'format'>,
  ): Promise<QueryNativeColumnsResult> {
    loadAddon() // fail fast before the server does any work
    const { query, ...rest } = params
    const { stream, query_id, response_headers } = await this.exec({
      ...rest,
      query: appendFormatNative(query),
    })
    const decoded = await decodeNativeStream(stream, rest.abort_signal)
    return { ...decoded, query_id, response_headers }
  }

  /**
   * Same fetch/decode path as {@link queryNativeColumns}, with the columns
   * fully materialized into JS rows — objects keyed by column name (default)
   * or positional arrays. Values keep Native semantics: 64-bit integers are
   * BigInt, temporal columns carry raw wire values, FixedString cells are
   * Buffers (see {@link QueryNativeRowsResult}).
   *
   * @experimental POC — see {@link queryNativeColumns}.
   */
  async queryNativeRows(
    params: Omit<QueryParams, 'format'> & { row_shape?: 'objects' | 'arrays' },
  ): Promise<QueryNativeRowsResult> {
    loadAddon() // fail fast before the server does any work
    const { query, row_shape, ...rest } = params
    const { stream, query_id, response_headers } = await this.exec({
      ...rest,
      query: appendFormatNative(query),
    })
    const decoded = await decodeNativeStream(stream, rest.abort_signal)
    const rows =
      row_shape === 'arrays'
        ? chunksToRowArrays(decoded.chunks)
        : chunksToRowObjects(decoded.chunks)
    return {
      rows,
      columnNames: decoded.columnNames,
      columnTypes: decoded.columnTypes,
      rowCount: decoded.rowCount,
      query_id,
      response_headers,
    }
  }
}

export function createClient(
  config?: NodeClickHouseClientConfigOptions,
): NodeClickHouseClient {
  // NB: must instantiate the subclass — the previous `as NodeClickHouseClient`
  // cast meant subclass-only methods did not exist at runtime.
  return new NodeClickHouseClient({
    impl: NodeConfigImpl,
    ...(config || {}),
  })
}
