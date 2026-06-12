import { describe, it, expect } from "vitest";
import {
  ClickHouseSpanKind,
  ClickHouseSpanNames,
  ClickHouseSpanStatusCode,
  type ClickHouseSpan,
  type ClickHouseSpanAttributes,
  type ClickHouseSpanOptions,
  type ClickHouseSpanStatus,
  type ClickHouseTracer,
} from "@clickhouse/client-common";
import { parseError } from "@clickhouse/client-common";
import { ClickHouseClient } from "../../src/client";
import { NoopClickHouseSpan } from "../../src/tracing";

class RecordedSpan implements ClickHouseSpan {
  readonly initialAttributes: ClickHouseSpanAttributes;
  attributes: ClickHouseSpanAttributes;
  status?: ClickHouseSpanStatus;
  exception?: Error;
  ended = false;

  constructor(
    readonly name: string,
    readonly options?: ClickHouseSpanOptions,
  ) {
    this.initialAttributes = { ...options?.attributes };
    this.attributes = { ...options?.attributes };
  }
  setAttributes(attributes: ClickHouseSpanAttributes) {
    this.attributes = { ...this.attributes, ...attributes };
  }
  setStatus(status: ClickHouseSpanStatus) {
    this.status = status;
  }
  recordException(error: Error) {
    this.exception = error;
  }
  end() {
    this.ended = true;
  }
}

function createRecordingTracer(): {
  tracer: ClickHouseTracer<RecordedSpan>;
  spans: RecordedSpan[];
} {
  const spans: RecordedSpan[] = [];
  const tracer: ClickHouseTracer<RecordedSpan> = {
    startActiveSpan(name, options, fn) {
      const span = new RecordedSpan(name, options);
      spans.push(span);
      return fn(span);
    },
  };
  return { tracer, spans };
}

interface MockConnection {
  query: ReturnType<typeof makeQuery>;
  command: ReturnType<typeof makeCommand>;
  exec: ReturnType<typeof makeExec>;
  insert: ReturnType<typeof makeInsert>;
  ping: ReturnType<typeof makePing>;
  close: () => Promise<void>;
}

function makeQuery(impl?: () => Promise<any>) {
  return (
    impl ??
    (async () => ({
      stream: {} as any,
      query_id: "q-1",
      response_headers: {},
    }))
  );
}
function makeCommand(impl?: () => Promise<any>) {
  return impl ?? (async () => ({ query_id: "c-1", response_headers: {} }));
}
function makeExec(impl?: () => Promise<any>) {
  return (
    impl ??
    (async () => ({
      stream: {} as any,
      query_id: "e-1",
      response_headers: {},
    }))
  );
}
function makeInsert(impl?: () => Promise<any>) {
  return impl ?? (async () => ({ query_id: "i-1", response_headers: {} }));
}
function makePing(impl?: () => Promise<any>) {
  return impl ?? (async () => ({ success: true }));
}

function buildClient(
  tracer: ClickHouseTracer<any> | undefined,
  overrides: Partial<MockConnection> = {},
  extraConfig: Record<string, unknown> = {},
): ClickHouseClient {
  const connection: MockConnection = {
    query: makeQuery(overrides.query),
    command: makeCommand(overrides.command),
    exec: makeExec(overrides.exec),
    insert: makeInsert(overrides.insert),
    ping: makePing(overrides.ping),
    close: async () => {},
  };
  return new ClickHouseClient({
    url: "http://localhost:8123",
    database: "my_db",
    application: "my_app",
    tracer,
    ...extraConfig,
    impl: {
      make_connection: () => connection as any,
      make_result_set: ((_s, _f, q, _log, _h, _j, span_tracker) => ({
        query_id: q,
        // Test result set: pretend immediate full consumption.
        consume: () => span_tracker?.finish(),
        span_tracker,
      })) as any,
      values_encoder: () =>
        ({
          validateInsertValues: () => {},
          encodeValues: (v: any) =>
            typeof v === "string" ? v : JSON.stringify(v),
        }) as any,
    },
  });
}

describe("tracer", () => {
  it("emits a CLIENT span for query() with unset status and query_id attribute", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer);
    const rs = await client.query({ query: "SELECT 1", query_id: "caller-q" });
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(span.name).toBe(ClickHouseSpanNames.query);
    expect(span.options?.kind).toBe(ClickHouseSpanKind.CLIENT);
    expect(span.initialAttributes["db.system.name"]).toBe("clickhouse");
    expect(span.initialAttributes["db.namespace"]).toBe("my_db");
    expect(span.initialAttributes["server.address"]).toBe("localhost");
    expect(span.initialAttributes["server.port"]).toBe(8123);
    expect(span.initialAttributes["clickhouse.application"]).toBe("my_app");
    expect(span.initialAttributes["clickhouse.response.format"]).toBe("JSON");
    expect(span.initialAttributes["clickhouse.request.query_id"]).toBe(
      "caller-q",
    );
    expect(span.attributes["clickhouse.request.query_id"]).toBe("q-1");
    // Per the OTEL spec, the status is left unset on success.
    expect(span.status).toBeUndefined();
    expect(span.exception).toBeUndefined();
    // The span stays open until the ResultSet is consumed or closed.
    expect(span.ended).toBe(false);
    (rs as any).consume();
    expect(span.ended).toBe(true);
  });

  it("records the response metrics on the query span when the ResultSet is consumed", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer);
    const rs = await client.query({ query: "SELECT 1" });
    const tracker = (rs as any).span_tracker;
    tracker.addBytes(42);
    tracker.addRows(2);
    tracker.addRows(1);
    tracker.finish();
    // Subsequent finish() calls are no-ops.
    tracker.finish(new Error("ignored"));
    const [span] = spans;
    expect(span.attributes["clickhouse.response.decoded_bytes"]).toBe(42);
    expect(span.attributes["db.response.returned_rows"]).toBe(3);
    expect(span.status).toBeUndefined();
    expect(span.exception).toBeUndefined();
    expect(span.ended).toBe(true);
  });

  it("records streaming errors on the query span via the tracker", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer);
    const rs = await client.query({ query: "SELECT 1" });
    const tracker = (rs as any).span_tracker;
    tracker.addBytes(10);
    tracker.finish(new Error("stream failed"));
    const [span] = spans;
    expect(span.attributes["clickhouse.response.decoded_bytes"]).toBe(10);
    // No rows were counted - the attribute must not be reported.
    expect(span.attributes["db.response.returned_rows"]).toBeUndefined();
    expect(span.exception?.message).toBe("stream failed");
    expect(span.status?.code).toBe(ClickHouseSpanStatusCode.ERROR);
    expect(span.ended).toBe(true);
  });

  it("emits the operation span via startActiveSpan", async () => {
    const calls: string[] = [];
    const tracer: ClickHouseTracer = {
      startActiveSpan(name, _options, fn) {
        calls.push(`start:${name}`);
        const result = fn(NoopClickHouseSpan);
        calls.push(`returned:${name}`);
        return result;
      },
    };
    const client = buildClient(tracer);
    await client.query({ query: "SELECT 1" });
    expect(calls).toEqual([
      "start:clickhouse.query",
      "returned:clickhouse.query",
    ]);
  });

  it("emits a span for command() with unset status", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer);
    await client.command({ query: "CREATE TABLE t (a UInt8) ENGINE = Memory" });
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe(ClickHouseSpanNames.command);
    expect(spans[0].attributes["clickhouse.request.query_id"]).toBe("c-1");
    expect(spans[0].status).toBeUndefined();
    expect(spans[0].ended).toBe(true);
  });

  it("emits a span for exec()", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer);
    await client.exec({ query: "SELECT 1" });
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe(ClickHouseSpanNames.exec);
    expect(spans[0].attributes["clickhouse.request.query_id"]).toBe("e-1");
    expect(spans[0].status).toBeUndefined();
  });

  it("emits a span for insert()", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer);
    await client.insert({ table: "my_table", values: [{ a: 1 }] });
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe(ClickHouseSpanNames.insert);
    expect(spans[0].initialAttributes["db.operation.name"]).toBe("INSERT");
    expect(spans[0].initialAttributes["db.collection.name"]).toBe("my_table");
    expect(spans[0].initialAttributes["clickhouse.request.format"]).toBe(
      "JSONCompactEachRow",
    );
    expect(spans[0].attributes["clickhouse.request.query_id"]).toBe("i-1");
    expect(spans[0].status).toBeUndefined();
  });

  it("records sent_rows and encoded_bytes for array-based inserts", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer);
    await client.insert({ table: "my_table", values: [{ a: 1 }, { a: 2 }] });
    const [span] = spans;
    expect(span.initialAttributes["clickhouse.request.sent_rows"]).toBe(2);
    // The mock encoder produces JSON.stringify([{a:1},{a:2}]).
    expect(span.attributes["clickhouse.request.encoded_bytes"]).toBe(
      JSON.stringify([{ a: 1 }, { a: 2 }]).length,
    );
  });

  it("does not record sent_rows or encoded_bytes for streamed inserts", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer);
    // Anything that is not an array nor encoded to a string stands for a stream.
    const stream = { pipe: () => {} };
    const clientAny = client as any;
    clientAny.valuesEncoder.encodeValues = () => stream;
    await client.insert({ table: "my_table", values: stream as any });
    const [span] = spans;
    expect(
      span.initialAttributes["clickhouse.request.sent_rows"],
    ).toBeUndefined();
    expect(span.attributes["clickhouse.request.encoded_bytes"]).toBeUndefined();
  });

  it("does NOT emit an insert span when there are no rows to insert", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer);
    const result = await client.insert({ table: "my_table", values: [] });
    expect(result.executed).toBe(false);
    expect(spans).toHaveLength(0);
  });

  it("records db.response.status_code when the connection reports it", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer, {
      query: async () => ({
        stream: {} as any,
        query_id: "q-1",
        response_headers: {},
        http_status_code: 200,
      }),
    });
    await client.query({ query: "SELECT 1" });
    expect(spans[0].attributes["db.response.status_code"]).toBe(200);
  });

  it("records clickhouse.summary.* attributes when the summary is present", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer, {
      command: async () => ({
        query_id: "c-1",
        response_headers: {},
        http_status_code: 200,
        summary: {
          read_rows: "10",
          read_bytes: "100",
          written_rows: "5",
          written_bytes: "50",
          total_rows_to_read: "10",
          result_rows: "5",
          result_bytes: "50",
          elapsed_ns: "1000",
        },
      }),
    });
    await client.command({ query: "INSERT INTO t SELECT * FROM s" });
    const attrs = spans[0].attributes;
    expect(attrs["db.response.status_code"]).toBe(200);
    expect(attrs["clickhouse.summary.read_rows"]).toBe("10");
    expect(attrs["clickhouse.summary.written_rows"]).toBe("5");
    expect(attrs["clickhouse.summary.result_bytes"]).toBe("50");
    expect(attrs["clickhouse.summary.elapsed_ns"]).toBe("1000");
  });

  it("emits a span for ping()", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer);
    await client.ping();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe(ClickHouseSpanNames.ping);
    expect(spans[0].initialAttributes["clickhouse.ping.select"]).toBe(false);
    expect(spans[0].status).toBeUndefined();
  });

  it("records the exception and sets ERROR status when an operation throws", async () => {
    const { tracer, spans } = createRecordingTracer();
    const failure = new Error("boom");
    const client = buildClient(tracer, {
      query: async () => {
        throw failure;
      },
    });
    await expect(client.query({ query: "SELECT 1" })).rejects.toThrow("boom");
    expect(spans).toHaveLength(1);
    expect(spans[0].exception).toBe(failure);
    expect(spans[0].attributes["error.type"]).toBe("Error");
    expect(spans[0].status).toEqual({
      code: ClickHouseSpanStatusCode.ERROR,
      message: "boom",
    });
    expect(spans[0].ended).toBe(true);
  });

  it("sets error.type and clickhouse.error.code for server-side errors", async () => {
    const { tracer, spans } = createRecordingTracer();
    const failure = parseError(
      "Code: 62. DB::Exception: Syntax error: failed at position 1. (SYNTAX_ERROR) (version 24.3.1)",
    );
    const client = buildClient(tracer, {
      query: async () => {
        throw failure;
      },
    });
    await expect(client.query({ query: "SELECT 1" })).rejects.toThrow(failure);
    expect(spans[0].attributes["error.type"]).toBe("ClickHouseError");
    expect(spans[0].attributes["clickhouse.error.code"]).toBe("62");
    expect(spans[0].status?.code).toBe(ClickHouseSpanStatusCode.ERROR);
  });

  it("normalizes non-Error throwables before recordException", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer, {
      query: async () => {
        throw "string failure";
      },
    });
    await expect(client.query({ query: "SELECT 1" })).rejects.toBe(
      "string failure",
    );
    expect(spans[0].exception).toBeInstanceOf(Error);
    expect(spans[0].exception?.message).toBe("string failure");
    expect(spans[0].attributes["error.type"]).toBe("Error");
    expect(spans[0].status).toEqual({
      code: ClickHouseSpanStatusCode.ERROR,
      message: "string failure",
    });
  });

  it("uses the no-op tracer when none is configured", async () => {
    const client = buildClient(undefined);
    // Must not throw.
    const result = await client.query({ query: "SELECT 1" });
    expect(result).toBeDefined();
  });

  it("propagates tracer exceptions to the caller (no defensive wrapper)", async () => {
    const brokenTracer: ClickHouseTracer = {
      startActiveSpan: () => {
        throw new Error("start failed");
      },
    };
    const client = buildClient(brokenTracer);
    await expect(client.query({ query: "SELECT 1" })).rejects.toThrow(
      "start failed",
    );
  });

  it("propagates span method exceptions to the caller", async () => {
    const tracer: ClickHouseTracer = {
      startActiveSpan: (_name, _options, fn) =>
        fn({
          setAttributes: () => {
            throw new Error("setAttributes failed");
          },
          setStatus: () => {},
          recordException: () => {},
          end: () => {},
        }),
    };
    const client = buildClient(tracer);
    await expect(client.query({ query: "SELECT 1" })).rejects.toThrow(
      "setAttributes failed",
    );
  });

  it("still ends the span on success even when setStatus is a no-op", async () => {
    let ended = false;
    const tracer: ClickHouseTracer = {
      startActiveSpan: (_name, _options, fn) =>
        fn({
          setAttributes: () => {},
          setStatus: () => {},
          recordException: () => {},
          end: () => {
            ended = true;
          },
        }),
    };
    const client = buildClient(tracer);
    const rs = await client.query({ query: "SELECT 1" });
    (rs as any).consume();
    expect(ended).toBe(true);
  });

  describe("trace context propagation", () => {
    it("injects the trace context into the request HTTP headers inside the active span", async () => {
      const events: string[] = [];
      const captured: any[] = [];
      const tracer: ClickHouseTracer = {
        startActiveSpan(name, _options, fn) {
          events.push(`start:${name}`);
          return fn(NoopClickHouseSpan);
        },
      };
      const client = buildClient(
        tracer,
        {
          command: async (params: any) => {
            captured.push(params);
            return { query_id: "c-1", response_headers: {} };
          },
        },
        {
          trace_context_propagator: (carrier: Record<string, string>) => {
            events.push("inject");
            carrier["traceparent"] = "00-trace-span-01";
          },
        },
      );
      await client.command({
        query: "SELECT 1",
        http_headers: { "x-custom": "value" },
      });
      // The propagator must run inside startActiveSpan's callback.
      expect(events).toEqual(["start:clickhouse.command", "inject"]);
      expect(captured[0].http_headers).toEqual({
        "x-custom": "value",
        traceparent: "00-trace-span-01",
      });
    });

    it("injects the trace context for every operation", async () => {
      const captured: Record<string, any> = {};
      const client = buildClient(
        undefined,
        {
          query: async (params: any) => {
            captured.query = params.http_headers;
            return { stream: {} as any, query_id: "q", response_headers: {} };
          },
          command: async (params: any) => {
            captured.command = params.http_headers;
            return { query_id: "c", response_headers: {} };
          },
          exec: async (params: any) => {
            captured.exec = params.http_headers;
            return { stream: {} as any, query_id: "e", response_headers: {} };
          },
          insert: async (params: any) => {
            captured.insert = params.http_headers;
            return { query_id: "i", response_headers: {} };
          },
          ping: async (params: any) => {
            captured.ping = params.http_headers;
            return { success: true };
          },
        },
        {
          trace_context_propagator: (carrier: Record<string, string>) => {
            carrier["traceparent"] = "00-t-s-01";
          },
        },
      );
      await client.query({ query: "SELECT 1" });
      await client.command({ query: "SELECT 1" });
      await client.exec({ query: "SELECT 1" });
      await client.insert({ table: "t", values: [{ a: 1 }] });
      await client.ping();
      for (const op of ["query", "command", "exec", "insert", "ping"]) {
        expect(captured[op], op).toEqual({ traceparent: "00-t-s-01" });
      }
    });

    it("does not alter the request headers when no propagator is configured", async () => {
      const captured: any[] = [];
      const client = buildClient(undefined, {
        command: async (params: any) => {
          captured.push(params);
          return { query_id: "c-1", response_headers: {} };
        },
      });
      await client.command({
        query: "SELECT 1",
        http_headers: { "x-custom": "value" },
      });
      expect(captured[0].http_headers).toEqual({ "x-custom": "value" });
    });
  });
});
