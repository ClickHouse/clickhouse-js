// This example assumes that you have a ClickHouse server running locally
// (for example, from our root docker-compose.yml file).
//
// Demonstrates how to forward the client's per-operation lifecycle into
// OpenTelemetry via the zero-dependency `tracer` config option.
//
// The client ships only the `ClickHouseTracer` hook shape (no OpenTelemetry
// dependency of its own); that shape mirrors the OpenTelemetry `Span` API, so
// the adapter below is a thin, fully typed wrapper around `@opentelemetry/api`
// with no casts - which is exactly what "the OTEL types match" means here.
//
// To keep this example self-contained and runnable without an external
// collector, it wires up an in-memory span exporter from
// `@opentelemetry/sdk-trace-base` and prints the spans the client produced.
//
// See also:
//  - `../../../docs/howto/tracing.md` - full description of the hook surface.
import { SpanStatusCode, type Span } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { createClient, type ClickHouseTracer } from '@clickhouse/client'

// 1. Set up a minimal, in-memory OpenTelemetry tracer provider so that the
//    spans the client emits are actually recorded (the global no-op tracer
//    would silently drop them). A real application would instead register an
//    exporter that ships spans to its OTEL collector.
const exporter = new InMemorySpanExporter()
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
})
const otelTracer = provider.getTracer('@clickhouse/client')

// 2. Adapt the OpenTelemetry `Span` API to the client's `ClickHouseTracer`
//    hooks. `TSpan` is set to OpenTelemetry's `Span`, and every hook maps
//    one-to-one onto a real `Span` method with no type assertions:
//      - attribute bags pass straight into `startSpan`/`setAttributes`
//      - the `'UNSET' | 'OK' | 'ERROR'` status maps onto `SpanStatusCode`
//      - `recordException` accepts the unknown error as-is
const tracer: ClickHouseTracer<Span> = {
  startSpan: (name, attributes) => otelTracer.startSpan(name, { attributes }),
  setAttributes: (span, attributes) => span.setAttributes(attributes),
  setStatus: (span, status) => {
    if (status.code === 'OK') {
      span.setStatus({ code: SpanStatusCode.OK })
    } else if (status.code === 'ERROR') {
      span.setStatus({ code: SpanStatusCode.ERROR, message: status.message })
    } else {
      span.setStatus({ code: SpanStatusCode.UNSET })
    }
  },
  recordException: (span, error) =>
    span.recordException(error instanceof Error ? error : String(error)),
  endSpan: (span) => span.end(),
}

// 3. Pass the adapter through the client config; from here on, every
//    `query`/`command`/`exec`/`insert`/`ping` call is traced automatically.
const client = createClient({
  url: process.env['CLICKHOUSE_URL'], // defaults to 'http://localhost:8123'
  password: process.env['CLICKHOUSE_PASSWORD'], // defaults to an empty string
  tracer,
})

await client.ping()
const rs = await client.query({
  query: 'SELECT number FROM system.numbers LIMIT 3',
  format: 'JSONEachRow',
})
console.info('[OtelTracing] Query result:', await rs.json())

await client.close()

// 4. Flush and inspect the spans the client produced. Each operation yields a
//    single span named `clickhouse.<operation>` (also exported as
//    `ClickHouseSpanNames`) carrying OTEL-style attributes such as
//    `db.system`, `server.address`, and the server-assigned `clickhouse.query_id`.
await provider.forceFlush()
const spans = exporter.getFinishedSpans()
for (const span of spans) {
  console.info('[OtelTracing] Span:', {
    name: span.name,
    status: SpanStatusCode[span.status.code],
    'db.system': span.attributes['db.system'],
    'server.address': span.attributes['server.address'],
    'clickhouse.query_id': span.attributes['clickhouse.query_id'],
  })
}
await provider.shutdown()

const spanNames = spans.map((span) => span.name)
if (
  !spanNames.includes('clickhouse.ping') ||
  !spanNames.includes('clickhouse.query')
) {
  throw new Error(
    `[OtelTracing] Expected ping and query spans, but got: ${spanNames.join(', ')}`,
  )
}
console.info('[OtelTracing] Recorded spans:', spanNames)
