import { afterEach, describe, expect, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client-common";
import { createTestClient } from "@test/utils/client";
import { guid } from "@test/utils/guid";
import { isCloudTestEnv } from "@test/utils/test_env";

/** Mirrors the clickhouse-rs `tests/it/opentelemetry.rs` integration test:
 *  inject a W3C `traceparent` header via the `trace_context_propagator` hook
 *  and assert that the server records a matching span (with the same trace
 *  id) in `system.opentelemetry_span_log`.
 *
 *  No OpenTelemetry SDK is required: trace context propagation is just an
 *  HTTP header, so the test crafts a fixed traceparent manually. */
describe.skipIf(isCloudTestEnv())(
  "[Node.js] OTEL trace context propagation",
  () => {
    let client: ClickHouseClient;

    afterEach(async () => {
      await client.close();
    });

    it("links the server-side opentelemetry_span_log entries to the client trace", async () => {
      // 16 bytes (32 hex chars) trace id, 8 bytes (16 hex chars) parent span id.
      const traceId = randomHex(32);
      const parentSpanId = randomHex(16);
      client = createTestClient({
        trace_context_propagator: (carrier) => {
          carrier["traceparent"] = `00-${traceId}-${parentSpanId}-01`;
        },
      });

      const queryId = guid();
      const rs = await client.query({
        query: "SELECT 1 AS one",
        format: "JSONEachRow",
        query_id: queryId,
      });
      expect(await rs.json()).toEqual([{ one: 1 }]);

      // The span log is flushed in the background (flush_interval_milliseconds);
      // poll for the spans of our trace to appear.
      let spanCount = 0;
      for (let attempt = 0; attempt < 20 && spanCount === 0; attempt++) {
        await client.command({ query: "SYSTEM FLUSH LOGS" });
        const result = await client.query({
          query: `
            SELECT count() AS count
            FROM system.opentelemetry_span_log
            WHERE lower(hex(trace_id)) = {traceId: String}`,
          query_params: { traceId },
          format: "JSONEachRow",
        });
        const [{ count }] = await result.json<{ count: string | number }>();
        spanCount = Number(count);
        if (spanCount === 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      expect(spanCount).toBeGreaterThan(0);

      // The server span for our query carries the query id as an attribute.
      const result = await client.query({
        query: `
          SELECT count() AS count
          FROM system.opentelemetry_span_log
          WHERE lower(hex(trace_id)) = {traceId: String}
          AND attribute['clickhouse.query_id'] = {queryId: String}`,
        query_params: { traceId, queryId },
        format: "JSONEachRow",
      });
      const [{ count }] = await result.json<{ count: string | number }>();
      expect(Number(count)).toBeGreaterThan(0);
    });
  },
);

function randomHex(chars: number): string {
  let result = "";
  for (let i = 0; i < chars; i++) {
    result += Math.floor(Math.random() * 16).toString(16);
  }
  return result;
}
