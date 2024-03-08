import { ClickHouseClient } from '@clickhouse/client-common'
import type Stream from 'stream'
import type { NodeClickHouseClientConfigOptions } from './config'
import { NodeConfigImpl } from './config'

export type NodeClickHouseClient = ClickHouseClient<Stream.Readable>

export function createClient(
  config?: NodeClickHouseClientConfigOptions
): NodeClickHouseClient {
  return new ClickHouseClient({
    impl: NodeConfigImpl,
    ...(config || {}),
  })
}
