import { createTestClient } from '@test/utils'
import type Stream from 'stream'
import type {
  BaseClickHouseClientConfigOptions,
  ClickHouseClient,
} from '../../src'

export function createNodeTestClient(
  config: BaseClickHouseClientConfigOptions = {},
): ClickHouseClient {
  return createTestClient<Stream.Readable>(config) as ClickHouseClient
}
