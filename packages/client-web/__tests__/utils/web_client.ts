import { createTestClient } from "@test/utils";
import type { ClickHouseClientConfigOptions } from "@clickhouse/client-web";
import type { ClickHouseClient } from "@clickhouse/client-web";

export function createWebTestClient(
  config: ClickHouseClientConfigOptions = {},
): ClickHouseClient {
  return createTestClient(config) as unknown as ClickHouseClient;
}
