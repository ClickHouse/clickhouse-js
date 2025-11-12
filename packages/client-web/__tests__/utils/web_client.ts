import { createTestClient } from '@test/utils'
import type { ClickHouseClientConfigOptions } from '../../src'
import type { WebClickHouseClient } from '../../src/client'

export function createWebTestClient(
  config: ClickHouseClientConfigOptions = {},
): WebClickHouseClient {
  return createTestClient(config) as unknown as WebClickHouseClient
}
