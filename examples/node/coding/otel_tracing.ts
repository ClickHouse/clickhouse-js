// This example assumes that you have a ClickHouse server running locally
// (for example, from our root docker-compose.yml file).
//
// Demonstrates how to forward the client's per-operation lifecycle into
// OpenTelemetry via the zero-dependency `tracer` config option.
//
// The client ships only the `ClickHouseTracer` shape (no OpenTelemetry
// dependency of its own); that shape is a structural subset of the
// OpenTelemetry `Tracer`/`Span` APIs, so a raw OTEL tracer can be passed to
// the client **as-is**, with no adapter and no casts. The client runs each
// operation inside `tracer.startActiveSpan(...)`, so auto-instrumented child
// spans (e.g. from `@opentelemetry/instrumentation-http`) nest under the
// ClickHouse operation spans - provided the `AsyncLocalStorageContextManager`
// is registered (see step 1 below; the OpenTelemetry Node.js SDK registers it
// by default).
//
// To keep this example self-contained and runnable without an external
// collector, it wires up an in-memory span exporter from
// `@opentelemetry/sdk-trace-base` and prints the spans the client produced.
//
// See also:
//  - `../../../docs/howto/tracing.md` - full description of the tracer surface.
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { suppressTracing } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  createClient,
  type ClickHouseSpan,
  type ClickHouseTracer,
} from "@clickhouse/client";

// 1. Register the AsyncLocalStorageContextManager so that the span started by
//    `startActiveSpan` stays *active* across the `await` points inside the
//    client operation. This is required for active-span context propagation;
//    when using the full OpenTelemetry Node.js SDK (`@opentelemetry/sdk-node`
//    / `NodeTracerProvider`), this context manager is the default and this
//    step is unnecessary.
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());

// 2. Set up a minimal, in-memory OpenTelemetry tracer provider so that the
//    spans the client emits are actually recorded (the global no-op tracer
//    would silently drop them). A real application would instead register an
//    exporter that ships spans to its OTEL collector.
const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const otelTracer = provider.getTracer("@clickhouse/client");

// 3. The zero-adapter path: a raw OpenTelemetry tracer is structurally
//    assignable to `ClickHouseTracer` - this compiles with no casts.
const tracer: ClickHouseTracer = otelTracer;

// 4. Pass the tracer through the client config; from here on, every
//    `query`/`command`/`exec`/`insert`/`ping` call is traced automatically.
//    Trace context propagation (the W3C `traceparent` header) is handled
//    automatically by `@opentelemetry/instrumentation-http`, since the
//    client uses the platform HTTP stack.
const client = createClient({
  url: process.env["CLICKHOUSE_URL"], // defaults to 'http://localhost:8123'
  password: process.env["CLICKHOUSE_PASSWORD"], // defaults to an empty string
  tracer,
});

await client.ping();
const rs = await client.query({
  query: "SELECT number FROM system.numbers LIMIT 3",
  format: "JSONEachRow",
});
console.info("[OtelTracing] Query result:", await rs.json());

await client.close();

// 5. Flush and inspect the spans the client produced. Each operation yields a
//    single CLIENT-kind span named `clickhouse.<operation>` (also exported as
//    `ClickHouseSpanNames`) carrying OTEL-style attributes such as
//    `db.system.name`, `server.address`, and the server-assigned
//    `clickhouse.request.query_id`.
await provider.forceFlush();
const spans = exporter.getFinishedSpans();
for (const span of spans) {
  console.info("[OtelTracing] Span:", {
    name: span.name,
    status: SpanStatusCode[span.status.code],
    "db.system.name": span.attributes["db.system.name"],
    "server.address": span.attributes["server.address"],
    "server.port": span.attributes["server.port"],
    "clickhouse.request.query_id":
      span.attributes["clickhouse.request.query_id"],
  });
}

const spanNames = spans.map((span) => span.name);
if (
  !spanNames.includes("clickhouse.ping") ||
  !spanNames.includes("clickhouse.query")
) {
  throw new Error(
    `[OtelTracing] Expected ping and query spans, but got: ${spanNames.join(", ")}`,
  );
}
console.info("[OtelTracing] Recorded spans:", spanNames);

// ---------------------------------------------------------------------------
// Adapter recipes
//
// OTEL auto-instrumentation packages commonly expose two extra options -
// `requireParentSpan` and `suppressInternalInstrumentation`. Both are
// implemented here as thin wrappers around the raw OTEL tracer, composed in
// userland instead of being baked into the client.
// ---------------------------------------------------------------------------

// Recipe 1: `requireParentSpan` - only trace ClickHouse operations when there
// is already an active parent span; otherwise hand the client a no-op span.
// Useful to suppress noise from background health checks/pings that run
// outside any traced request.
const noop = () => undefined;
const noopSpan: ClickHouseSpan = {
  setAttributes: noop,
  setStatus: noop,
  recordException: noop,
  end: noop,
};
const requireParentSpanTracer: ClickHouseTracer = {
  startActiveSpan: (name, options, fn) =>
    trace.getSpan(context.active()) === undefined
      ? fn(noopSpan) // no active parent span - skip tracing this operation
      : otelTracer.startActiveSpan(name, options, fn),
};
const requireParentClient = createClient({
  url: process.env["CLICKHOUSE_URL"],
  password: process.env["CLICKHOUSE_PASSWORD"],
  tracer: requireParentSpanTracer,
});

exporter.reset();
// Outside any active span: no ClickHouse span is recorded.
await requireParentClient.ping();
// Inside a parent span: the ClickHouse span is recorded as its child.
await otelTracer.startActiveSpan("parent-request", async (parent) => {
  try {
    await requireParentClient.ping();
  } finally {
    parent.end();
  }
});
await requireParentClient.close();
await provider.forceFlush();
const requireParentSpanNames = exporter
  .getFinishedSpans()
  .map((span) => span.name);
if (
  requireParentSpanNames.filter((name) => name === "clickhouse.ping").length !==
  1
) {
  throw new Error(
    `[OtelTracing] Expected exactly one ping span (the one with a parent), but got: ${requireParentSpanNames.join(", ")}`,
  );
}
console.info(
  "[OtelTracing] requireParentSpan recipe spans:",
  requireParentSpanNames,
);

// Recipe 2: suppress nested HTTP spans - if
// `@opentelemetry/instrumentation-http` is registered, each ClickHouse
// operation span gets a duplicate child HTTP span for the underlying request.
// Running the operation under `suppressTracing` (from `@opentelemetry/core`)
// prevents those child spans while keeping the ClickHouse span itself.
// (Alternatively, configure the HTTP instrumentation's
// `ignoreOutgoingRequestHook` for your ClickHouse endpoint.)
const suppressNestedHttpTracer: ClickHouseTracer = {
  startActiveSpan: (name, options, fn) =>
    otelTracer.startActiveSpan(name, options, (span) =>
      context.with(suppressTracing(context.active()), () => fn(span)),
    ),
};
const suppressNestedHttpClient = createClient({
  url: process.env["CLICKHOUSE_URL"],
  password: process.env["CLICKHOUSE_PASSWORD"],
  tracer: suppressNestedHttpTracer,
});

exporter.reset();
await suppressNestedHttpClient.ping();
await suppressNestedHttpClient.close();
await provider.forceFlush();
const suppressedSpanNames = exporter
  .getFinishedSpans()
  .map((span) => span.name);
if (!suppressedSpanNames.includes("clickhouse.ping")) {
  throw new Error(
    `[OtelTracing] Expected a ping span from the suppressTracing recipe, but got: ${suppressedSpanNames.join(", ")}`,
  );
}
console.info(
  "[OtelTracing] suppressTracing recipe spans:",
  suppressedSpanNames,
);

await provider.shutdown();
