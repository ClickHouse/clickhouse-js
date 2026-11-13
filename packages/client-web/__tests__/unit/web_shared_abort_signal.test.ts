import { describe, it, expect, vi } from "vitest";
import { ClickHouseLogLevel, LogWriter } from "@clickhouse/client-common";
import { TestLogger } from "../../../client-common/__tests__/utils/test_logger";
import { WebConnection, type WebConnectionParams } from "../../src/connection";

// A fetch that stays pending until its AbortSignal aborts, then rejects.
// This stands in for an in-flight SELECT sleep(...) without a server.
function hangingFetch(): typeof fetch {
  return ((_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const fail = () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      };
      if (signal === undefined) {
        return;
      }
      if (signal.aborted) {
        fail();
        return;
      }
      signal.addEventListener("abort", fail, { once: true });
    })) as typeof fetch;
}

// A fetch that returns one chunk, then errors the body when its signal aborts.
function streamingFetch(): typeof fetch {
  return (async (_input, init) => {
    const signal = init?.signal;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("0\n"));
        if (signal === undefined) {
          return;
        }
        const fail = () => {
          controller.error(
            new DOMException("This operation was aborted", "AbortError"),
          );
        };
        if (signal.aborted) {
          fail();
          return;
        }
        signal.addEventListener("abort", fail, { once: true });
      },
    });
    return new Response(stream, { status: 200 });
  }) as typeof fetch;
}

function buildWebConnection(
  fetchImpl: typeof fetch,
  requestTimeout = 5_000,
): WebConnection {
  return new WebConnection({
    url: new URL("https://localhost:8443"),
    request_timeout: requestTimeout,
    compression: {
      decompress_response: undefined,
      compress_request: undefined,
    },
    max_open_connections: 10,
    auth: { username: "default", password: "", type: "Credentials" },
    database: "default",
    clickhouse_settings: {},
    log_writer: new LogWriter(
      new TestLogger(),
      "WebSharedAbortSignalTest",
      ClickHouseLogLevel.OFF,
    ),
    log_level: ClickHouseLogLevel.OFF,
    keep_alive: { enabled: false },
    fetch: fetchImpl,
  } as WebConnectionParams);
}

describe("[Web] shared abort signal", () => {
  it("cancels every in-flight request and keeps the caller onabort handler", async () => {
    const conn = buildWebConnection(hangingFetch());
    const controller = new AbortController();
    let callerHandlerRan = false;
    controller.signal.onabort = () => {
      callerHandlerRan = true;
    };

    const first = conn.command({
      query: "SELECT sleep(2)",
      abort_signal: controller.signal,
    });
    const second = conn.command({
      query: "SELECT sleep(2)",
      abort_signal: controller.signal,
    });
    controller.abort();

    await expect(first).rejects.toThrow("The user aborted a request.");
    await expect(second).rejects.toThrow("The user aborted a request.");
    expect(callerHandlerRan).toBe(true);
  });

  it("still cancels a response body read", async () => {
    const conn = buildWebConnection(streamingFetch());
    const controller = new AbortController();
    const result = await conn.query({
      query: "SELECT number FROM system.numbers",
      abort_signal: controller.signal,
    });
    const reader = result.stream.getReader();
    const firstChunk = await reader.read();
    expect(firstChunk.done).toBe(false);

    controller.abort();

    await expect(reader.read()).rejects.toThrow(/abort/i);
  });

  it("drops the abort listener when the request finishes", async () => {
    const summary = {
      read_rows: "1",
      read_bytes: "1",
      written_rows: "0",
      written_bytes: "0",
      total_rows_to_read: "1",
      result_rows: "1",
      result_bytes: "1",
      elapsed_ns: "1",
      memory_usage: "1",
    };
    const conn = buildWebConnection(async () => {
      return new Response("", {
        status: 200,
        headers: { "x-clickhouse-summary": JSON.stringify(summary) },
      });
    });
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");

    const result = await conn.command({
      query: "SELECT 1",
      abort_signal: controller.signal,
    });

    expect(result.summary).toEqual(summary);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("drops the abort listener after insert reads the body", async () => {
    const conn = buildWebConnection(
      async () => new Response("", { status: 200 }),
    );
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");

    await conn.insert({
      query: "INSERT INTO t FORMAT TabSeparated",
      values: "1\n",
      abort_signal: controller.signal,
    });

    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("still cancels a later request after an earlier one has finished", async () => {
    const hang = hangingFetch();
    let calls = 0;
    const conn = buildWebConnection((async (_input, init) => {
      calls += 1;
      if (calls === 1) {
        return new Response("", { status: 200 });
      }
      return hang(_input, init);
    }) as typeof fetch);
    const controller = new AbortController();

    await conn.command({
      query: "SELECT 1",
      abort_signal: controller.signal,
    });

    const later = conn.command({
      query: "SELECT sleep(2)",
      abort_signal: controller.signal,
    });
    controller.abort();

    await expect(later).rejects.toThrow("The user aborted a request.");
  });
});
