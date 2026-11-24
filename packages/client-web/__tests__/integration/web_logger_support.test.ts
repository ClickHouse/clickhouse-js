import {
  ClickHouseLogLevel,
  type ClickHouseClientConfigOptions,
  type Logger,
} from "@clickhouse/client-web";
import { createTestClient } from "@test/utils/client";
import { describe, expect, it, vi } from "vitest";

function createLoggingClient(
  level?: ClickHouseLogLevel,
  config?: Omit<ClickHouseClientConfigOptions, "log">,
) {
  const logs = {
    trace: vi.fn<Logger["trace"]>(),
    debug: vi.fn<Logger["debug"]>(),
    info: vi.fn<Logger["info"]>(),
    warn: vi.fn<Logger["warn"]>(),
    error: vi.fn<Logger["error"]>(),
  };
  class CaptureLogger implements Logger {
    trace = logs.trace;
    debug = logs.debug;
    info = logs.info;
    warn = logs.warn;
    error = logs.error;
  }
  const client = createTestClient({
    ...config,
    log: { LoggerClass: CaptureLogger, level },
  });
  return { client, logs };
}

describe("[Web] logger support", () => {
  it("reports query response metadata without adding request data to the logs", async () => {
    const { client, logs } = createLoggingClient(ClickHouseLogLevel.DEBUG);
    const value = "web-logger-request-only";
    try {
      const result = await client.query({
        query: "SELECT {value:String} AS value",
        format: "JSONEachRow",
        query_params: { value },
      });
      expect(await result.json()).toEqual([{ value }]);
      expect(logs.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.objectContaining({
            operation: "Query",
            query_id: result.query_id,
            response_status: 200,
          }),
        }),
      );
      expect(JSON.stringify(logs.debug.mock.calls)).not.toContain(value);
    } finally {
      await client.close();
    }
  });

  it("reports a failed command without logging the server's error text", async () => {
    const { client, logs } = createLoggingClient();
    const query_id = crypto.randomUUID();
    const value = "web-logger-sql-marker";
    try {
      await expect(
        client.command({ query: `SELECT throwIf(1, '${value}')`, query_id }),
      ).rejects.toMatchObject({
        code: "395",
        message: expect.stringContaining(value),
      });
      expect(logs.error).toHaveBeenCalledOnce();
      const entry = logs.error.mock.calls[0]![0];
      expect(entry.err.message).not.toContain(value);
      expect(entry.err.cause).toBeUndefined();
      expect(logs.error).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.objectContaining({
            operation: "Command",
            query_id,
            response_status: 500,
          }),
        }),
      );
      expect(logs.debug).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("reports a failed ping without logging a custom fetch error", async () => {
    const value = "web-logger-fetch-marker";
    const failure = new Error(value, { cause: new Error(value) });
    const { client, logs } = createLoggingClient(undefined, {
      fetch: () => Promise.reject(failure),
    });
    try {
      expect(await client.ping()).toMatchObject({
        success: false,
        error: failure,
      });
      expect(logs.warn).toHaveBeenCalledOnce();
      const entry = logs.warn.mock.calls[0]![0];
      expect(entry.args).toMatchObject({ operation: "Ping" });
      expect(entry.err?.message).not.toContain(value);
      expect(entry.err?.cause).toBeUndefined();
    } finally {
      await client.close();
    }
  });

  it("keeps response parser errors with the caller", async () => {
    const failure = new SyntaxError("web-logger-response-marker");
    const { client, logs } = createLoggingClient(undefined, {
      json: {
        parse<T>(text: string): T {
          const value: unknown = JSON.parse(text);
          if (value !== null && typeof value === "object" && "data" in value) {
            throw failure;
          }
          return value as T;
        },
      },
    });
    try {
      const result = await client.query({ query: "SELECT 1", format: "JSON" });
      await expect(result.json()).rejects.toBe(failure);
      expect(logs.error).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("reports a malformed response summary without logging its contents", async () => {
    const value = "web-logger-header-marker";
    const { client, logs } = createLoggingClient(undefined, {
      fetch: async () =>
        new Response('{"n":1}\n', {
          headers: { "x-clickhouse-summary": value },
        }),
    });
    try {
      const result = await client.query({
        query: "SELECT 1",
        format: "JSONEachRow",
      });
      expect(await result.json()).toEqual([{ n: 1 }]);
      expect(logs.warn).toHaveBeenCalledOnce();
      expect(JSON.stringify(logs.warn.mock.calls)).not.toContain(value);
    } finally {
      await client.close();
    }
  });
});
