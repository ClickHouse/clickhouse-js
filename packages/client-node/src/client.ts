import {
  ClickHouseClient,
  type DataFormat,
  QueryParams,
} from '@clickhouse/client-common'
import type Stream from 'stream'
import type { NodeClickHouseClientConfigOptions } from './config'
import { NodeConfigImpl } from './config'
import { ResultSet } from './result_set'

export type NodeClickHouseClient = Omit<
  ClickHouseClient<Stream.Readable>,
  'query'
> & {
  query<Format extends DataFormat | undefined = undefined>(
    params: Omit<QueryParams, 'format'> & { format?: Format }
  ): Promise<ResultSet<Format extends undefined ? 'JSON' : NonNullable<Format>>>
}

export function createClient(
  config?: NodeClickHouseClientConfigOptions
): NodeClickHouseClient {
  return new ClickHouseClient({
    impl: NodeConfigImpl,
    ...(config || {}),
  }) as any
}
