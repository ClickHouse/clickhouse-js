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
  url = "http://localhost:8123",
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
    url,
    database: "my_db",
    application: "my_app",
    tracer,
    impl: {
      make_connection: () => connection as any,
      make_result_set: ((_s, _f, q) => ({ query_id: q }) as any) as any,
      values_encoder: () =>
        ({
          validateInsertValues: () => {},
          encodeValues: (v: any) => v,
        }) as any,
    },
  });
}

describe("tracer", () => {
  it("emits a CLIENT span for query() with OK status and query_id attribute", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer);
    await client.query({ query: "SELECT 1", query_id: "caller-q" });
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(span.name).toBe(ClickHouseSpanNames.query);
    expect(span.options?.kind).toBe(ClickHouseSpanKind.CLIENT);
    expect(span.initialAttributes["db.system.name"]).toBe("clickhouse");
    expect(span.initialAttributes["db.operation.name"]).toBe("query");
    expect(span.initialAttributes["db.namespace"]).toBe("my_db");
    expect(span.initialAttributes["server.address"]).toBe("localhost");
    expect(span.initialAttributes["server.port"]).toBe(8123);
    expect(span.initialAttributes["clickhouse.application"]).toBe("my_app");
    expect(span.initialAttributes["clickhouse.format"]).toBe("JSON");
    expect(span.initialAttributes["clickhouse.query_id"]).toBe("caller-q");
    expect(span.attributes["clickhouse.query_id"]).toBe("q-1");
    expect(span.status).toEqual({ code: ClickHouseSpanStatusCode.OK });
    expect(span.exception).toBeUndefined();
    expect(span.ended).toBe(true);
  });

  it("derives server.port from the protocol when the URL has no explicit port", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer, {}, "https://my.clickhouse.cloud");
    await client.query({ query: "SELECT 1" });
    expect(spans).toHaveLength(1);
    expect(spans[0].initialAttributes["server.address"]).toBe(
      "my.clickhouse.cloud",
    );
    expect(spans[0].initialAttributes["server.port"]).toBe(443);
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

  it("emits a span for command() with OK status", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer);
    await client.command({ query: "CREATE TABLE t (a UInt8) ENGINE = Memory" });
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe(ClickHouseSpanNames.command);
    expect(spans[0].attributes["clickhouse.query_id"]).toBe("c-1");
    expect(spans[0].status).toEqual({ code: ClickHouseSpanStatusCode.OK });
    expect(spans[0].ended).toBe(true);
  });

  it("emits a span for exec()", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer);
    await client.exec({ query: "SELECT 1" });
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe(ClickHouseSpanNames.exec);
    expect(spans[0].attributes["clickhouse.query_id"]).toBe("e-1");
    expect(spans[0].status).toEqual({ code: ClickHouseSpanStatusCode.OK });
  });

  it("emits a span for insert()", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer);
    await client.insert({ table: "my_table", values: [{ a: 1 }] });
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe(ClickHouseSpanNames.insert);
    expect(spans[0].initialAttributes["db.operation.name"]).toBe("insert");
    expect(spans[0].initialAttributes["db.collection.name"]).toBe("my_table");
    expect(spans[0].initialAttributes["clickhouse.format"]).toBe(
      "JSONCompactEachRow",
    );
    expect(spans[0].attributes["clickhouse.query_id"]).toBe("i-1");
    expect(spans[0].status).toEqual({ code: ClickHouseSpanStatusCode.OK });
  });

  it("does NOT emit an insert span when there are no rows to insert", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer);
    const result = await client.insert({ table: "my_table", values: [] });
    expect(result.executed).toBe(false);
    expect(spans).toHaveLength(0);
  });

  it("emits a span for ping()", async () => {
    const { tracer, spans } = createRecordingTracer();
    const client = buildClient(tracer);
    await client.ping();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe(ClickHouseSpanNames.ping);
    expect(spans[0].initialAttributes["clickhouse.ping.select"]).toBe(false);
    expect(spans[0].status).toEqual({ code: ClickHouseSpanStatusCode.OK });
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
    expect(spans[0].status).toEqual({
      code: ClickHouseSpanStatusCode.ERROR,
      message: "boom",
    });
    expect(spans[0].ended).toBe(true);
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
    await client.query({ query: "SELECT 1" });
    expect(ended).toBe(true);
  });
});
