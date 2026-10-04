// Import directly from the side-effect-free module (not from `@test/utils`)
// so that creating a simple client never registers the shared `beforeAll`
// test-environment initializer and stays runnable without ClickHouse.
import { createSimpleTestClient } from "@test/utils/simple_client";
import type { ClickHouseClientConfigOptions } from "@clickhouse/client-web";
import type { ClickHouseClient } from "@clickhouse/client-web";

export function createSimpleWebTestClient(
  config: ClickHouseClientConfigOptions = {},
): ClickHouseClient {
  return createSimpleTestClient(config) as unknown as ClickHouseClient;
}
