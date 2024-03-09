import type {
  DataFormat,
  QueryParamsWithFormat,
  QueryParamsWithoutFormat,
} from '@clickhouse/client-common'
import { ClickHouseClient } from '@clickhouse/client-common'
import type Stream from 'stream'
import type { NodeClickHouseClientConfigOptions } from './config'
import { NodeConfigImpl } from './config'
import type { ResultSet } from './result_set'

export class NodeClickHouseClient extends ClickHouseClient<Stream.Readable> {
  /** Overloads for proper {@link DataFormat} variants handling.
   *  See the implementation: {@link ClickHouseClient.query} */
  async query(
    params: QueryParamsWithoutFormat & { format: undefined }
  ): Promise<ResultSet<'JSON'>>
  async query(params: QueryParamsWithoutFormat): Promise<ResultSet<'JSON'>>
  async query<Format extends DataFormat>(
    params: QueryParamsWithFormat<Format>
  ): Promise<ResultSet<Format>>

  /** See the base implementation: {@link ClickHouseClient.query} */
  query<Format extends DataFormat>(
    params: QueryParamsWithFormat<Format>
  ): Promise<ResultSet<Format>> {
    return super.query(params) as any
  }
}

export function createClient(
  config?: NodeClickHouseClientConfigOptions
): NodeClickHouseClient {
  return new ClickHouseClient<Stream.Readable>({
    impl: NodeConfigImpl,
    ...(config || {}),
  }) as any
}
