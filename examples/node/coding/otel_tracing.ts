// This example assumes that you have a ClickHouse server running locally
// (for example, from our root docker-compose.yml file).
//
// Demonstrates how to forward the client's per-operation lifecycle into
// OpenTelemetry via the zero-dependency `tracer` config option.
//
// The client ships only the `ClickHouseTracer` shape (no OpenTelemetry
// dependency of its own); that shape is a structural subset of the
// OpenTelemetry `Tracer`/`Span` APIs, so a raw OTEL tracer can be passed to
// the client **as-is**, with no adapter and no casts. Optionally, a tiny
// wrapper adds `withActiveSpan` so that auto-instrumented child spans (e.g.
// from `@opentelemetry/instrumentation-http`) nest under the ClickHouse
// operation spans.
//
// To keep this example self-contained and runnable without an external
// collector, it wires up an in-memory span exporter from
// `@opentelemetry/sdk-trace-base` and prints the spans the client produced.
//
// See also:
//  - `../../../docs/howto/tracing.md` - full description of the tracer surface.
import { context, trace, SpanStatusCode, type Span } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { createClient, type ClickHouseTracer } from "@clickhouse/client";

// 1. Set up a minimal, in-memory OpenTelemetry tracer provider so that the
//    spans the client emits are actually recorded (the global no-op tracer
//    would silently drop them). A real application would instead register an
//    exporter that ships spans to its OTEL collector.
const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const otelTracer = provider.getTracer("@clickhouse/client");

// 2. The zero-adapter path: a raw OpenTelemetry tracer is structurally
//    assignable to `ClickHouseTracer` - this compiles with no casts, and you
//    could pass `otelTracer` to `createClient` directly.
const zeroAdapterTracer: ClickHouseTracer<Span> = otelTracer;
void zeroAdapterTracer;

// 3. Optionally, add the `withActiveSpan` scope function so that the
//    ClickHouse operation span becomes the *active* span while the request
//    runs - auto-instrumented child spans will then be parented under it.
const tracer: ClickHouseTracer<Span> = {
  startSpan: (name, options) => otelTracer.startSpan(name, options),
  withActiveSpan: (span, fn) =>
    context.with(trace.setSpan(context.active(), span), fn),
};

// 4. Pass the tracer through the client config; from here on, every
//    `query`/`command`/`exec`/`insert`/`ping` call is traced automatically.
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
//    `db.system`, `server.address`, and the server-assigned `clickhouse.query_id`.
await provider.forceFlush();
const spans = exporter.getFinishedSpans();
for (const span of spans) {
  console.info("[OtelTracing] Span:", {
    name: span.name,
    status: SpanStatusCode[span.status.code],
    "db.system": span.attributes["db.system"],
    "server.address": span.attributes["server.address"],
    "clickhouse.query_id": span.attributes["clickhouse.query_id"],
  });
}
await provider.shutdown();

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
