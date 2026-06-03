// Import directly from the side-effect-free module (not from `@test/utils`)
// so that creating a simple client never registers the shared `beforeAll`
// test-environment initializer and stays runnable without ClickHouse.
import { createSimpleTestClient } from '@test/utils/simple_client'
import type { ClickHouseClientConfigOptions } from '../../src'
import type { WebClickHouseClient } from '../../src/client'

export function createSimpleWebTestClient(
  config: ClickHouseClientConfigOptions = {},
): WebClickHouseClient {
  return createSimpleTestClient(config) as unknown as WebClickHouseClient
}
