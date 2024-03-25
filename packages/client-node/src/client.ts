import type {
  DataFormat,
  QueryParamsWithFormat,
} from '@clickhouse/client-common'
import { ClickHouseClient } from '@clickhouse/client-common'
import type Stream from 'stream'
import type { NodeClickHouseClientConfigOptions } from './config'
import { NodeConfigImpl } from './config'
import type { ResultSet } from './result_set'

export class NodeClickHouseClient extends ClickHouseClient<Stream.Readable> {
  /** See the base implementation: {@link ClickHouseClient.query} */
  query<Format extends DataFormat = 'JSON'>(
    params: QueryParamsWithFormat<Format>,
  ): Promise<ResultSet<Format>> {
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
