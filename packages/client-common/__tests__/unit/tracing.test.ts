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
  configOverrides: Record<string, unknown> = {},
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
    ...configOverrides,
    impl: {
      make_connection: () => connection as any,
      make_result_set: ((_s, _f, q, _log, _h, _j, span) => ({
        query_id: q,
        // Test result set: pretend immediate full consumption.
        consume: () => span?.end(),
        span,
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
    // query() emits two spans: clickhouse.query (HTTP request) and
    // clickhouse.query.stream (ResultSet consumption).
    expect(spans).toHaveLength(2);
    const [querySpan, streamSpan] = spans;
    expect(querySpan.name).toBe(ClickHouseSpanNames.query);
    expect(querySpan.options?.kind).toBe(ClickHouseSpanKind.CLIENT);
    expect(querySpan.initialAttributes["db.system.name"]).toBe("clickhouse");
    expect(querySpan.initialAttributes["db.namespace"]).toBe("my_db");
    expect(querySpan.initialAttributes["server.address"]).toBe("localhost");
    expect(querySpan.initialAttributes["server.port"]).toBe(8123);
    expect(querySpan.initialAttributes["clickhouse.application"]).toBe(
      "my_app",
    );
    expect(querySpan.initialAttributes["clickhouse.response.format"]).toBe(
      "JSON",
    );
    expect(querySpan.initialAttributes["clickhouse.request.query_id"]).toBe(
      "caller-q",
    );
    expect(querySpan.attributes["clickhouse.request.query_id"]).toBe("q-1");
    // Per the OTEL spec, the status is left unset on success.
    expect(querySpan.status).toBeUndefined();
    expect(querySpan.exception).toBeUndefined();
    // The query span ends as soon as the HTTP response headers are received.
    expect(querySpan.ended).toBe(true);
    // The stream span stays open until the ResultSet is consumed or closed.
    expect(streamSpan.name).toBe(ClickHouseSpanNames.query_stream);
    expect(streamSpan.ended).toBe(false);
    (rs as any).consume();
    expect(streamSpan.ended).toBe(true);
  });

  it("hands the stream span to the ResultSet without ending it", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer);
    const rs = await client.query({ query: "SELECT 1" });
    const [querySpan, streamSpan] = spans;
    // The query span ends immediately after the HTTP response is received.
    expect(querySpan.ended).toBe(true);
    // The stream span is passed to the ResultSet and owns its lifetime.
    expect((rs as any).span).toBe(streamSpan);
    expect(streamSpan.ended).toBe(false);
    (rs as any).consume();
    expect(streamSpan.ended).toBe(true);
  });

  it("records the error on the stream span and ends it when makeResultSet throws", async () => {
    const { tracer, spans } = createRecordingTracer();
    const connection: MockConnection = {
      query: makeQuery(),
      command: makeCommand(),
      exec: makeExec(),
      insert: makeInsert(),
      ping: makePing(),
      close: async () => {},
    };
    const client = new ClickHouseClient({
      url: "http://localhost:8123",
      tracer,
      impl: {
        make_connection: () => connection as any,
        make_result_set: (() => {
          throw new Error("make_result_set failed");
        }) as any,
        values_encoder: () =>
          ({
            validateInsertValues: () => {},
            encodeValues: (v: any) =>
              typeof v === "string" ? v : JSON.stringify(v),
          }) as any,
      },
    });
    await expect(client.query({ query: "SELECT 1" })).rejects.toThrow(
      "make_result_set failed",
    );
    // The query span ends normally (HTTP response was received).
    expect(spans[0].name).toBe(ClickHouseSpanNames.query);
    expect(spans[0].ended).toBe(true);
    expect(spans[0].exception).toBeUndefined();
    // The stream span captures the makeResultSet error.
    expect(spans[1].name).toBe(ClickHouseSpanNames.query_stream);
    expect(spans[1].exception?.message).toBe("make_result_set failed");
    expect(spans[1].status?.code).toBe(ClickHouseSpanStatusCode.ERROR);
    expect(spans[1].ended).toBe(true);
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
      "start:clickhouse.query.stream",
      "returned:clickhouse.query.stream",
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

  it("records sent_rows for array-based inserts", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer);
    await client.insert({ table: "my_table", values: [{ a: 1 }, { a: 2 }] });
    const [span] = spans;
    expect(span.initialAttributes["clickhouse.request.sent_rows"]).toBe(2);
  });

  it("does not record sent_rows for streamed inserts", async () => {
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
          memory_usage: "4580679",
          real_time_microseconds: "12345",
        },
      }),
    });
    await client.command({ query: "INSERT INTO t SELECT * FROM s" });
    const attrs = spans[0].attributes;
    expect(attrs["db.response.status_code"]).toBe(200);
    expect(attrs["clickhouse.summary.read_rows"]).toBe("10");
    expect(attrs["clickhouse.summary.read_bytes"]).toBe("100");
    expect(attrs["clickhouse.summary.written_rows"]).toBe("5");
    expect(attrs["clickhouse.summary.written_bytes"]).toBe("50");
    expect(attrs["clickhouse.summary.result_rows"]).toBe("5");
    expect(attrs["clickhouse.summary.result_bytes"]).toBe("50");
    expect(attrs["clickhouse.summary.total_rows_to_read"]).toBe("10");
    expect(attrs["clickhouse.summary.elapsed_ns"]).toBe("1000");
    expect(attrs["clickhouse.summary.memory_usage"]).toBe("4580679");
    expect(attrs["clickhouse.summary.real_time_microseconds"]).toBe("12345");
  });

  it("records clickhouse.summary.* attributes on the query span when the summary is present", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer, {
      query: async () => ({
        stream: {} as any,
        query_id: "q-1",
        response_headers: {},
        http_status_code: 200,
        summary: {
          read_rows: "6568",
          read_bytes: "3894304",
          written_rows: "0",
          written_bytes: "0",
          total_rows_to_read: "6568",
          result_rows: "0",
          result_bytes: "0",
          elapsed_ns: "10693523",
          memory_usage: "4580679",
        },
      }),
    });
    await client.query({ query: "SELECT 1" });
    // The summary is attached to the outer clickhouse.query span.
    const attrs = spans[0].attributes;
    expect(spans[0].name).toBe(ClickHouseSpanNames.query);
    expect(attrs["clickhouse.summary.read_rows"]).toBe("6568");
    expect(attrs["clickhouse.summary.total_rows_to_read"]).toBe("6568");
    expect(attrs["clickhouse.summary.elapsed_ns"]).toBe("10693523");
    expect(attrs["clickhouse.summary.memory_usage"]).toBe("4580679");
  });

  it("omits optional summary attributes that the server did not return", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer, {
      command: async () => ({
        query_id: "c-1",
        response_headers: {},
        summary: {
          read_rows: "10",
          read_bytes: "100",
          written_rows: "5",
          written_bytes: "50",
          total_rows_to_read: "10",
          result_rows: "5",
          result_bytes: "50",
          elapsed_ns: "1000",
          // memory_usage / real_time_microseconds absent (older server).
        },
      }),
    });
    await client.command({ query: "INSERT INTO t SELECT * FROM s" });
    const attrs = spans[0].attributes;
    expect("clickhouse.summary.memory_usage" in attrs).toBe(false);
    expect("clickhouse.summary.real_time_microseconds" in attrs).toBe(false);
  });

  it("does NOT attach db.query.text by default", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer);
    await client.query({ query: "SELECT secret_column FROM secrets" });
    expect("db.query.text" in spans[0].initialAttributes).toBe(false);
  });

  it("attaches db.query.text when dangerously_log_query_text is enabled", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(
      tracer,
      {},
      { dangerously_log_query_text: true },
    );
    await client.query({ query: "SELECT 42" });
    // The query span carries the actual SQL sent (with the FORMAT suffix).
    expect(spans[0].initialAttributes["db.query.text"]).toBe(
      "SELECT 42 \nFORMAT JSON",
    );
  });

  it("attaches db.query.text for command/exec/insert when enabled", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(
      tracer,
      {},
      { dangerously_log_query_text: true },
    );
    await client.command({ query: "CREATE TABLE t (a UInt8) ENGINE = Memory" });
    await client.exec({ query: "SELECT 1 FORMAT CSV" });
    await client.insert({ table: "my_table", values: [{ a: 1 }] });
    const byName = (name: string) => spans.find((s) => s.name === name)!;
    expect(
      byName(ClickHouseSpanNames.command).initialAttributes["db.query.text"],
    ).toBe("CREATE TABLE t (a UInt8) ENGINE = Memory");
    expect(
      byName(ClickHouseSpanNames.exec).initialAttributes["db.query.text"],
    ).toBe("SELECT 1 FORMAT CSV");
    expect(
      byName(ClickHouseSpanNames.insert).initialAttributes["db.query.text"],
    ).toContain("INSERT INTO my_table");
  });

  it("merges caller-provided span_attributes onto the span", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer);
    await client.query({
      query: "SELECT 1",
      span_attributes: {
        "tag.route": "events.getAgentGraphData",
        "tag.projectId": "cmbam0px50001ad08fr8ls6ok",
        "tag.tag_schema_version": 1,
      },
    });
    const attrs = spans[0].initialAttributes;
    expect(attrs["tag.route"]).toBe("events.getAgentGraphData");
    expect(attrs["tag.projectId"]).toBe("cmbam0px50001ad08fr8ls6ok");
    expect(attrs["tag.tag_schema_version"]).toBe(1);
    // Core semantic-convention attributes are still present.
    expect(attrs["db.system.name"]).toBe("clickhouse");
  });

  it("does not let span_attributes override core attributes", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer);
    await client.query({
      query: "SELECT 1",
      span_attributes: {
        "db.system.name": "not-clickhouse",
        "db.namespace": "hijacked",
      },
    });
    const attrs = spans[0].initialAttributes;
    expect(attrs["db.system.name"]).toBe("clickhouse");
    expect(attrs["db.namespace"]).toBe("my_db");
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
    expect(spans[0].attributes["clickhouse.error.code"]).toBe(62);
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

  it("passes the request HTTP headers through unaltered", async () => {
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
