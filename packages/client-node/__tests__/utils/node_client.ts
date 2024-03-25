import { createTestClient } from '@test/utils'
import type Stream from 'stream'
import type { NodeClickHouseClient } from '../../src'
import { type BaseClickHouseClientConfigOptions } from '../../src'

export function createNodeTestClient(
  config: BaseClickHouseClientConfigOptions = {},
): NodeClickHouseClient {
  return createTestClient<Stream.Readable>(config) as NodeClickHouseClient
}
