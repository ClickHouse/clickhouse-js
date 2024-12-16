import type {
  DataFormat,
  IsSame,
  QueryParamsWithFormat,
} from '@clickhouse/client-common'
import { ClickHouseClient } from '@clickhouse/client-common'
import type Stream from 'stream'
import type { NodeClickHouseClientConfigOptions } from './config'
import { NodeConfigImpl } from './config'
import type { ResultSet } from './result_set'

/** If the Format is not a literal type, fall back to the default behavior of the ResultSet,
 *  allowing to call all methods with all data shapes variants,
 *  and avoiding generated types that include all possible DataFormat literal values. */
export type QueryResult<Format extends DataFormat> =
  IsSame<Format, DataFormat> extends true
    ? ResultSet<unknown>
    : ResultSet<Format>

export type ExternalData = {
  name: string
  data: Stream.Readable
  format: string
  structure: string
}

export interface WithExternalData {
  external?: ExternalData
}

export class NodeClickHouseClient extends ClickHouseClient<Stream.Readable> {
  /** See {@link ClickHouseClient.query}. */
  query<Format extends DataFormat = 'JSON'>(
    params: QueryParamsWithFormat<Format> & WithExternalData,
  ): Promise<QueryResult<Format>> {
    return super.query(params) as Promise<ResultSet<Format>>
  }
}

export function createClient(
  config?: NodeClickHouseClientConfigOptions,
): NodeClickHouseClient {
  return new ClickHouseClient<Stream.Readable>({
    impl: NodeConfigImpl,
    ...(config || {}),
  }) as NodeClickHouseClient
}
