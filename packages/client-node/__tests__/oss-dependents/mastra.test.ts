/**
 * mastra-ai/mastra — ClickHouse JS client usage example
 * =====================================================
 *
 *   Repo:        https://github.com/mastra-ai/mastra  (~23k★)
 *   Package:     @clickhouse/client  ^1.20.0
 *   Lives in:    stores/clickhouse
 *   Analysed at: 02087e1fbc54aa07f3071f7a200df1bf5be601a8
 *
 * How the client is used
 * ----------------------
 * ClickHouse is one of Mastra's pluggable STORAGE ADAPTERS. The
 * `stores/clickhouse` package implements the framework's storage interface
 * across several domains: memory (threads/messages), observability (traces,
 * logs, metrics, scores, feedback), workflows and background tasks.
 *
 * Key patterns:
 *   - `import type { ClickHouseClient, ClickHouseClientConfigOptions }`.
 *   - A central DB module creates the client; domain modules issue typed
 *     reads/writes.
 *   - "v-next" observability domain mirrors OTel-style tracing tables.
 *
 * References (pinned to ref=02087e1fbc54aa07f3071f7a200df1bf5be601a8):
 *   - Storage entry:   https://github.com/mastra-ai/mastra/blob/02087e1fbc54aa07f3071f7a200df1bf5be601a8/stores/clickhouse/src/storage/index.ts
 *   - DB/client module: https://github.com/mastra-ai/mastra/blob/02087e1fbc54aa07f3071f7a200df1bf5be601a8/stores/clickhouse/src/storage/db/index.ts
 *   - Observability:   https://github.com/mastra-ai/mastra/blob/02087e1fbc54aa07f3071f7a200df1bf5be601a8/stores/clickhouse/src/storage/domains/observability/v-next/index.ts
 *   - Dependency:      https://github.com/mastra-ai/mastra/blob/02087e1fbc54aa07f3071f7a200df1bf5be601a8/stores/clickhouse/package.json
 *
 * Reproduction targets the current 1.x API and runs against the test ClickHouse.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  type ClickHouseClient,
  type ClickHouseClientConfigOptions,
} from "@clickhouse/client";
import { createTestClient, guid } from "@test/utils";

describe("oss-dependents / mastra", () => {
  const table = `oss_mastra_messages_${guid()}`;

  // Central DB module: builds the client shared by all storage domains.
  class ClickHouseStore {
    private client: ClickHouseClient;

    constructor() {
      // Exercise the Node config-options type, then hand it to the test helper.
      const options: ClickHouseClientConfigOptions = {
        clickhouse_settings: {
          // Mastra relies on best-effort datetime parsing for OTel timestamps.
          date_time_input_format: "best_effort",
        },
      };
      this.client = createTestClient(options);
    }

    // Memory domain: persist a thread message.
    async saveMessage(message: {
      threadId: string;
      role: string;
      content: string;
    }): Promise<void> {
      await this.client.insert({
        table,
        values: [message],
        format: "JSONEachRow",
      });
    }

    // Memory domain read with a parameterised filter.
    async getMessages(threadId: string) {
      const result = await this.client.query({
        query: `SELECT threadId, role, content FROM ${table} WHERE threadId = {threadId:String}`,
        query_params: { threadId },
        format: "JSONEachRow",
      });
      return result.json<{ threadId: string; role: string; content: string }>();
    }

    async createSchema(): Promise<void> {
      await this.client.command({
        query: `CREATE TABLE ${table} (threadId String, role String, content String) ENGINE = MergeTree ORDER BY threadId`,
        clickhouse_settings: { wait_end_of_query: 1 },
      });
    }

    async close(): Promise<void> {
      await this.client.command({ query: `DROP TABLE IF EXISTS ${table}` });
      await this.client.close();
    }
  }

  let store: ClickHouseStore;
  afterEach(async () => {
    await store.close();
  });

  it("ClickHouseClientConfigOptions + best_effort, insert + parameterised read", async () => {
    store = new ClickHouseStore();
    await store.createSchema();
    await store.saveMessage({
      threadId: "th_1",
      role: "user",
      content: "hello",
    });
    expect(await store.getMessages("th_1")).toEqual([
      { threadId: "th_1", role: "user", content: "hello" },
    ]);
  });
});
