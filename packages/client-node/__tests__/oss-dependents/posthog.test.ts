/**
 * PostHog/posthog — ClickHouse JS client usage example
 * ====================================================
 *
 *   Repo:        https://github.com/PostHog/posthog  (~33k★)
 *   Package:     @clickhouse/client  ^1.12.0
 *   Lives in:    nodejs/ (the TypeScript services; ClickHouse is core to PostHog)
 *   Analysed at: 000d0abdab8c45eb5456741c68a361562a5b8fc8
 *
 * How the client is used
 * ----------------------
 * ClickHouse is PostHog's primary analytics database. Within the NODE.JS
 * services the JS client is used by the CDP (customer-data-platform) workers and
 * the session-replay recording API to query/stream events. (The main query path
 * historically goes through the Python/Django backend; the JS client covers the
 * Node service surface.)
 *
 * Key patterns:
 *   - `import { ClickHouseClient, createClient as createClickHouseClient }`.
 *   - Custom `https` agent passed to `createClient` for connection tuning.
 *   - `ExecResult` + `node:stream` `Readable` in test helpers for streaming reads.
 *   - `jest.mock('@clickhouse/client')` with `query`/`close` stubs in unit tests.
 *
 * References (pinned to ref=000d0abdab8c45eb5456741c68a361562a5b8fc8):
 *   - Session-replay API: https://github.com/PostHog/posthog/blob/000d0abdab8c45eb5456741c68a361562a5b8fc8/nodejs/src/session-replay/recording-api/recording-api.ts
 *   - CDP rerun worker:   https://github.com/PostHog/posthog/blob/000d0abdab8c45eb5456741c68a361562a5b8fc8/nodejs/src/cdp/consumers/cdp-rerun-worker.consumer.ts
 *   - Test helper:        https://github.com/PostHog/posthog/blob/000d0abdab8c45eb5456741c68a361562a5b8fc8/nodejs/tests/helpers/clickhouse.ts
 *   - Dependency:         https://github.com/PostHog/posthog/blob/000d0abdab8c45eb5456741c68a361562a5b8fc8/nodejs/package.json
 *
 * Reproduction note: upstream tunes connections with a `node:https` Agent (their
 * endpoint is TLS). The test ClickHouse is plain HTTP, so we pass a `node:http`
 * Agent here — the point under test is the `http_agent` / `keep_alive` config
 * surface plus `query(...).stream()` consumed as a `Readable`.
 */

import { Agent } from "node:http";
import type { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { type ClickHouseClient } from "@clickhouse/client";
import { createTestClient, guid } from "@test/utils";

describe("oss-dependents / posthog", () => {
  // A custom http agent tunes connection pooling for the Node services.
  const httpAgent = new Agent({ keepAlive: true, maxSockets: 10 });
  let client: ClickHouseClient;
  const table = `oss_posthog_${guid()}`;

  function createConnection(): ClickHouseClient {
    return createTestClient({
      http_agent: httpAgent,
      // PostHog disables the client keep-alive in favour of the custom agent.
      keep_alive: { enabled: false },
    });
  }

  // Session-replay recording API: stream rows for a recording.
  async function streamRecording(
    c: ClickHouseClient,
    sessionId: string,
  ): Promise<Readable> {
    const result = await c.query({
      query: `SELECT * FROM ${table} WHERE session_id = {sessionId:String}`,
      query_params: { sessionId },
      format: "JSONEachRow",
    });
    return result.stream() as unknown as Readable;
  }

  afterEach(async () => {
    await client.command({ query: `DROP TABLE IF EXISTS ${table}` });
    await client.close();
    httpAgent.destroy();
  });

  it("custom http_agent + disabled keep_alive, streamed reads", async () => {
    client = createConnection();
    await client.command({
      query: `CREATE TABLE ${table} (session_id String, seq UInt32) ENGINE = MergeTree ORDER BY (session_id, seq)`,
      clickhouse_settings: { wait_end_of_query: 1 },
    });
    await client.insert({
      table,
      values: [
        { session_id: "sess_1", seq: 1 },
        { session_id: "sess_1", seq: 2 },
        { session_id: "sess_2", seq: 1 },
      ],
      format: "JSONEachRow",
    });

    const stream = await streamRecording(client, "sess_1");
    let rowCount = 0;
    for await (const rows of stream) {
      rowCount += (rows as unknown[]).length; // each chunk is an array of Row objects
    }
    expect(rowCount).toBe(2);
  });
});
