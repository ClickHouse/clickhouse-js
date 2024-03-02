import { ClickHouseClient } from '@clickhouse/client-common'
import type Stream from 'stream'
import type { NodeClickHouseClientConfigOptions } from './config'
import { NodeConfigImpl } from './config'

export function createClient(
  config?: NodeClickHouseClientConfigOptions
): ClickHouseClient<Stream.Readable> {
  return new ClickHouseClient({
    impl: NodeConfigImpl,
    ...(config || {}),
  })
}
