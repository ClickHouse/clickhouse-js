/**
 * Unit tests for the pluggable Connection injection point.
 *
 * `createClient({ connection })` is the public hook for third-party
 * backends (e.g. an embedded chdb-node) to plug into the Node client.
 * This file verifies the two contract guarantees:
 *
 *   1. When a `Connection` is injected, the default HTTP factory
 *      (`NodeConnectionFactory.create`) is NOT invoked.
 *   2. The shared `ClickHouseClient` routes its public methods
 *      (`query`, `insert`, `command`, `exec`, `ping`, `close`) through
 *      the injected connection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stream from "stream";
import { Readable } from "stream";

import { createClient } from "../../src/client";
import * as connectionModule from "../../src/connection";
import {
  ClickHouseSpanNames,
  ClickHouseSpanStatusCode,
  type ClickHouseSpan,
  type ClickHouseTracer,
  type Connection,
  type ConnBaseQueryParams,
  type ConnExecParams,
  type ConnInsertParams,
} from "../../src/common/index";

beforeEach(() => {
  vi.restoreAllMocks();
});

function readableFromString(s: string): Readable {
  return Readable.from([Buffer.from(s, "utf8")]);
}

function makeStubConnection(): Connection<Stream.Readable> & {
  /** Bookkeeping so the test can assert which methods were touched. */
  calls: Array<{ op: string; params: unknown }>;
} {
  const calls: Array<{ op: string; params: unknown }> = [];
  const stub = {
    connectionName: "stub" as const,
    calls,
    close: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue({ success: true as const }),
    query: vi.fn((p: ConnBaseQueryParams) => {
      calls.push({ op: "query", params: p });
      return Promise.resolve({
        stream: readableFromString('{"n":1}\n'),
        query_id: "stub-query-id",
        response_headers: {},
        http_status_code: 200,
      });
    }),
    insert: vi.fn((p: ConnInsertParams<Stream.Readable>) => {
      calls.push({ op: "insert", params: p });
      return Promise.resolve({
        query_id: "stub-insert-id",
        response_headers: {},
        http_status_code: 200,
        summary: {
          read_rows: "0",
          read_bytes: "0",
          written_rows: "1",
          written_bytes: "1",
          result_rows: "0",
          result_bytes: "0",
          elapsed_ns: "1",
        },
      });
    }),
    command: vi.fn((p: ConnBaseQueryParams) => {
      calls.push({ op: "command", params: p });
      return Promise.resolve({
        query_id: "stub-command-id",
        response_headers: {},
        http_status_code: 200,
        summary: {
          read_rows: "0",
          read_bytes: "0",
          written_rows: "0",
          written_bytes: "0",
          result_rows: "0",
          result_bytes: "0",
          elapsed_ns: "1",
        },
      });
    }),
    exec: vi.fn((p: ConnExecParams<Stream.Readable>) => {
      calls.push({ op: "exec", params: p });
      return Promise.resolve({
        stream: readableFromString(""),
        query_id: "stub-exec-id",
        response_headers: {},
        http_status_code: 200,
        summary: {
          read_rows: "0",
          read_bytes: "0",
          written_rows: "0",
          written_bytes: "0",
          result_rows: "0",
          result_bytes: "0",
          elapsed_ns: "1",
        },
      });
    }),
  };
  return stub;
}

describe("[Node.js] createClient({ connection }) — pluggable backend injection", () => {
  it("does NOT call NodeConnectionFactory.create when a connection is injected", () => {
    const createSpy = vi.spyOn(
      connectionModule.NodeConnectionFactory,
      "create",
    );
    const stub = makeStubConnection();

    const client = createClient({ connection: stub });

    expect(createSpy).not.toHaveBeenCalled();
    expect(client).toBeDefined();
  });

  it("DOES call NodeConnectionFactory.create when no connection is injected (default HTTP path unchanged)", () => {
    const createSpy = vi.spyOn(
      connectionModule.NodeConnectionFactory,
      "create",
    );

    createClient({ url: "http://localhost:8123" });

    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it("routes client.query through the injected connection's query()", async () => {
    const stub = makeStubConnection();
    const client = createClient({ connection: stub });

    const rs = await client.query({ query: "SELECT 1", format: "JSONEachRow" });
    expect(stub.query).toHaveBeenCalledTimes(1);
    // ConnBaseQueryParams shape — `query` is the SQL string as written, and
    // the format is passed as the `default_format` setting.
    expect(stub.calls[0]?.op).toBe("query");
    const params = stub.calls[0]?.params as ConnBaseQueryParams;
    expect(params.query).toBe("SELECT 1");
    expect(params.clickhouse_settings?.default_format).toBe("JSONEachRow");
    // ResultSet drains the injected stream.
    const rows = await rs.json();
    expect(rows).toEqual([{ n: 1 }]);
  });

  describe("X-ClickHouse-Format response header", () => {
    function stubWithFormatHeader(
      header: string | string[] | undefined,
      tracer?: ClickHouseTracer,
    ) {
      const stub = makeStubConnection();
      stub.query.mockImplementationOnce(() => {
        return Promise.resolve({
          stream: readableFromString('{"n":1}\n'),
          query_id: "stub-query-id",
          response_headers: { "x-clickhouse-format": header },
          http_status_code: 200,
        });
      });
      return createClient({ connection: stub, tracer });
    }

    /** A span that counts `end()` calls, to check the exactly-once contract. */
    class CountingSpan implements ClickHouseSpan {
      endCount = 0;
      exception?: Error;
      statusCode?: ClickHouseSpanStatusCode;
      constructor(readonly name: string) {}
      setAttributes() {}
      setStatus(status: { code: ClickHouseSpanStatusCode }) {
        this.statusCode = status.code;
      }
      recordException(error: Error) {
        this.exception = error;
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

    it.each([["JSONEachRow"], ["jsoneachrow"], [["JSONEachRow"]], [undefined]])(
      "returns the result set when the header is %j",
      async (header) => {
        const client = stubWithFormatHeader(header);
        const rs = await client.query({
          query: "SELECT 1",
          format: "JSONEachRow",
        });
        expect(await rs.json()).toEqual([{ n: 1 }]);
      },
    );

    it("throws when the query's own FORMAT clause differs from the format option", async () => {
      const client = stubWithFormatHeader("CSV");
      await expect(
        client.query({ query: "SELECT 1 FORMAT CSV", format: "JSON" }),
      ).rejects.toThrow(/responded in the CSV format.*JSON format/s);
    });

    it("records the format mismatch on the stream span and ends it exactly once", async () => {
      const { tracer, spans } = countingTracer();
      const client = stubWithFormatHeader("CSV", tracer);
      await expect(
        client.query({ query: "SELECT 1 FORMAT CSV", format: "JSON" }),
      ).rejects.toThrow(/responded in the CSV format/);

      const streamSpan = spans.find(
        (s) => s.name === ClickHouseSpanNames.query_stream,
      );
      expect(streamSpan).toBeDefined();
      expect(streamSpan!.endCount).toBe(1);
      expect(streamSpan!.statusCode).toBe(ClickHouseSpanStatusCode.ERROR);
      expect(streamSpan!.exception?.message).toMatch(
        /responded in the CSV format/,
      );
      // The request span is unaffected: the HTTP request itself succeeded.
      const querySpan = spans.find((s) => s.name === ClickHouseSpanNames.query);
      expect(querySpan?.endCount).toBe(1);
      expect(querySpan?.exception).toBeUndefined();
    });
  });

  it("routes client.insert through the injected connection's insert()", async () => {
    const stub = makeStubConnection();
    const client = createClient({ connection: stub });

    await client.insert({
      table: "t",
      values: [{ id: 1 }],
      format: "JSONEachRow",
    });
    expect(stub.insert).toHaveBeenCalledTimes(1);
    expect(stub.calls[0]?.op).toBe("insert");
    // Client translates { table, format, values } into an `INSERT ... FORMAT X` query string.
    expect(
      (stub.calls[0]?.params as ConnInsertParams<Stream.Readable>).query,
    ).toContain("INSERT INTO t");
  });

  it("routes client.command through the injected connection's command()", async () => {
    const stub = makeStubConnection();
    const client = createClient({ connection: stub });

    await client.command({ query: "CREATE TABLE t (x Int32) ENGINE = Memory" });
    expect(stub.command).toHaveBeenCalledTimes(1);
    expect(stub.calls[0]?.op).toBe("command");
  });

  it("routes client.exec through the injected connection's exec()", async () => {
    const stub = makeStubConnection();
    const client = createClient({ connection: stub });

    await client.exec({ query: "SELECT 1" });
    expect(stub.exec).toHaveBeenCalledTimes(1);
    expect(stub.calls[0]?.op).toBe("exec");
  });

  it("routes client.ping through the injected connection's ping()", async () => {
    const stub = makeStubConnection();
    const client = createClient({ connection: stub });

    const r = await client.ping();
    expect(stub.ping).toHaveBeenCalledTimes(1);
    expect(r.success).toBe(true);
  });

  it("routes client.close through the injected connection's close()", async () => {
    const stub = makeStubConnection();
    const client = createClient({ connection: stub });

    await client.close();
    expect(stub.close).toHaveBeenCalledTimes(1);
  });
});
