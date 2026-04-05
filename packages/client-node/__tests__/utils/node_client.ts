import { createTestClient, createSimpleTestClient } from '@test/utils'
import type Stream from 'stream'
import type { ClickHouseClient, ClickHouseClientConfigOptions } from '../../src'

export function createNodeTestClient(
  config: ClickHouseClientConfigOptions = {},
): ClickHouseClient {
  return createTestClient<Stream.Readable>(config) as ClickHouseClient
}

export function createSimpleNodeTestClient(
  config: ClickHouseClientConfigOptions = {},
): ClickHouseClient {
  return createSimpleTestClient<Stream.Readable>(config) as ClickHouseClient
}
