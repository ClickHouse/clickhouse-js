import { describe, it, expect } from "vitest";
import {
  ClickHouseSpanNames,
  ClickHouseSpanStatusCode,
  type ClickHouseSpan,
  type ClickHouseTracer,
} from "@clickhouse/client-web";
import { createSimpleWebTestClient } from "../utils/simple_web_client";

/** A span that counts `end()` calls, to check the exactly-once contract.
 *  Exceptions are kept in order, as OpenTelemetry keeps each one as an event. */
class CountingSpan implements ClickHouseSpan {
  endCount = 0;
  exceptions: Error[] = [];
  statusCode?: ClickHouseSpanStatusCode;
  constructor(readonly name: string) {}
  setAttributes() {}
  setStatus(status: { code: ClickHouseSpanStatusCode }) {
    this.statusCode = status.code;
  }
  recordException(error: Error) {
    this.exceptions.push(error);
  }
  end() {
    this.endCount++;
  }
}

function countingTracer() {
  const spans: CountingSpan[] = [];
  const tracer: ClickHouseTracer<CountingSpan> = {
    startActiveSpan(name, _options, fn) {
      const span = new CountingSpan(name);
      spans.push(span);
      return fn(span);
    },
  };
  return { tracer, spans };
}

// The server answered in CSV (the query had its own FORMAT clause) while the
// client asked for JSON: query() closes the ResultSet and throws.
function createClientAnsweringInCSV(body: BodyInit | null) {
  const { tracer, spans } = countingTracer();
  const mockedFetch: typeof fetch = async () =>
    new Response(body, {
      status: 200,
      headers: { "x-clickhouse-format": "CSV" },
    });
  const client = createSimpleWebTestClient({
    url: "http://localhost:8123",
    fetch: mockedFetch,
    tracer,
  });
  return { client, spans };
}

// close() is asynchronous on Web and query() does not await it; let the
// cancellation settle so the span bookkeeping it does is observable.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("[Web] query() response format mismatch", () => {
  it("records the mismatch on the stream span and ends it exactly once", async () => {
    const { client, spans } = createClientAnsweringInCSV("1,2\n");
    await expect(
      client.query({ query: "SELECT 1 FORMAT CSV", format: "JSON" }),
    ).rejects.toThrow(/responded in the CSV format.*JSON format/s);
    await settle();

    const streamSpan = spans.find(
      (s) => s.name === ClickHouseSpanNames.query_stream,
    );
    expect(streamSpan).toBeDefined();
    expect(streamSpan!.endCount).toBe(1);
    expect(streamSpan!.statusCode).toBe(ClickHouseSpanStatusCode.ERROR);
    expect(streamSpan!.exceptions.map((e) => e.message)).toEqual([
      expect.stringMatching(/responded in the CSV format/),
    ]);
  });

  // Cancelling an errored ReadableStream rejects. That rejection belongs to
  // the cleanup, not to the caller: it must not become an unhandled rejection
  // (vitest fails the run on one) and the span must still end exactly once.
  it("does not leak a rejected stream cancellation during cleanup", async () => {
    const erroredBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("connection reset mid-response"));
      },
    });
    const { client, spans } = createClientAnsweringInCSV(erroredBody);
    await expect(
      client.query({ query: "SELECT 1 FORMAT CSV", format: "JSON" }),
    ).rejects.toThrow(/responded in the CSV format/);
    await settle();

    const streamSpan = spans.find(
      (s) => s.name === ClickHouseSpanNames.query_stream,
    );
    expect(streamSpan!.endCount).toBe(1);
    // The mismatch is recorded first; close() then adds the cancellation
    // failure it ran into, so neither cause is lost.
    expect(streamSpan!.exceptions.map((e) => e.message)).toEqual([
      expect.stringMatching(/responded in the CSV format/),
      "connection reset mid-response",
    ]);
  });
});
