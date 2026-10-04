// Import directly from the side-effect-free module (not from `@test/utils`)
// so that creating a simple client never registers the shared `beforeAll`
// test-environment initializer and stays runnable without ClickHouse.
import { createSimpleTestClient } from "@test/utils/simple_client";
import type Stream from "stream";
import type {
  ClickHouseClient,
  ClickHouseClientConfigOptions,
} from "@clickhouse/client";

export function createSimpleNodeTestClient(
  config: ClickHouseClientConfigOptions = {},
): ClickHouseClient {
  return createSimpleTestClient<Stream.Readable>(config) as ClickHouseClient;
}
