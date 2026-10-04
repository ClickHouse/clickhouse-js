import { createTestClient } from "@test/utils";
import type Stream from "stream";
import type {
  ClickHouseClient,
  ClickHouseClientConfigOptions,
} from "@clickhouse/client";

export function createNodeTestClient(
  config: ClickHouseClientConfigOptions = {},
): ClickHouseClient {
  return createTestClient<Stream.Readable>(config) as ClickHouseClient;
}
