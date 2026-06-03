# Tracing the ClickHouse client with the `tracer` hooks API

`@clickhouse/client` (and `@clickhouse/client-web`) ships a small,
**zero-dependency** `tracer` configuration option you can use to plug the
client's per-operation lifecycle into any tracing or metrics backend - most
notably [OpenTelemetry](https://opentelemetry.io/), but also Prometheus
counters, a plain `EventEmitter`, or your own logger.

The tracer hook surface lives entirely inside the client (no extra packages
on `npm install`, nothing to add to your bundle) and the hot path is just a
handful of direct method calls when a tracer is configured, and literally
nothing when it is not.

## Why hooks instead of a built-in dependency

OpenTelemetry's full Node.js distribution (`@opentelemetry/sdk-node` +
`@opentelemetry/sdk-metrics`) adds several megabytes of dependencies on top of
the ~500&nbsp;KB OpenTelemetry API package (`@opentelemetry/api`) and is
undesirable for many users. The client therefore ships **only the hook
shape**, which mirrors the OpenTelemetry
[`Span` API](https://opentelemetry.io/docs/specs/otel/trace/api/#span) so an
OTEL adapter is a trivial wrapper - and users who don't want tracing pay
nothing for it, on disk or at runtime.

## Hook surface

```ts
import type {
  ClickHouseTracer,
  ClickHouseTracerSpanAttributes,
  ClickHouseTracerSpanStatus,
} from '@clickhouse/client' // or '@clickhouse/client-web'

interface ClickHouseTracer<TSpan = unknown> {
  startSpan(name: string, attributes?: ClickHouseTracerSpanAttributes): TSpan
  setAttributes(span: TSpan, attributes: ClickHouseTracerSpanAttributes): void
  setStatus(span: TSpan, status: ClickHouseTracerSpanStatus): void
  recordException(span: TSpan, error: unknown): void
  endSpan(span: TSpan): void
}
```

`TSpan` is opaque to the client - whatever object your `startSpan`
implementation returns is what the client will pass back to the other hooks.

## When the hooks are called

For every call to `query` / `command` / `exec` / `insert` / `ping` (with the
single exception of `insert` with an empty `values` array, which short-circuits
before talking to the server), the client invokes:

1. `startSpan(name, initialAttributes)` - one of
   `clickhouse.query`, `clickhouse.command`, `clickhouse.exec`,
   `clickhouse.insert`, `clickhouse.ping` (also exported as
   `ClickHouseSpanNames`). The initial attribute bag always includes
   `db.system`, `db.namespace`, `server.address`, and - when set -
   `clickhouse.application`, plus operation-specific entries such as
   `clickhouse.format`, `clickhouse.table`, `clickhouse.query_id`, and
   `clickhouse.session_id`.
2. `setAttributes(span, { 'clickhouse.query_id': <server-assigned id> })` - so
   you always have the final `query_id`, even when the caller did not pass one
   and the connection layer generated it.
3. `setStatus(span, { code: 'OK' })` on success, or
   `recordException(span, error)` immediately followed by
   `setStatus(span, { code: 'ERROR', message })` on failure.
4. `endSpan(span)` - always, in a `finally` block.

Hook calls are inlined directly on the client's hot path and are **not**
wrapped in defensive try/catch - if your tracer throws, the exception
propagates to the caller of `query` / `command` / `exec` / `insert` /
`ping`. Make sure your tracer implementation doesn't throw.

> **Stream lifecycle:** for `query`/`exec`, the span ends when the request
> promise settles (i.e. headers received, stream handed to the caller). The
> client does not currently emit a separate "download finished" span when the
> returned `ResultSet` stream is fully consumed; if you need that, wrap the
> stream on the caller side.

## OpenTelemetry adapter

```ts
import { createClient, type ClickHouseTracer } from '@clickhouse/client'
import { trace, type Span, SpanStatusCode } from '@opentelemetry/api'

const otelTracer = trace.getTracer('@clickhouse/client')

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

const client = createClient({ url: 'http://localhost:8123', tracer })
```

A complete, runnable version of this adapter (wired to an in-memory span
exporter so you can see the emitted spans) lives in
[`examples/node/coding/otel_tracing.ts`](../../examples/node/coding/otel_tracing.ts).

## Recording-only tracer for tests / debugging

```ts
import type { ClickHouseTracer } from '@clickhouse/client'

interface RecordedSpan {
  name: string
  attributes: Record<string, unknown>
  status?: { code: 'OK' | 'ERROR'; message?: string }
  error?: unknown
}

const recorded: RecordedSpan[] = []
const tracer: ClickHouseTracer<RecordedSpan> = {
  startSpan: (name, attributes = {}) => {
    const span: RecordedSpan = { name, attributes: { ...attributes } }
    recorded.push(span)
    return span
  },
  setAttributes: (span, attrs) => Object.assign(span.attributes, attrs),
  setStatus: (span, status) => {
    span.status = status.code === 'UNSET' ? undefined : status
  },
  recordException: (span, err) => {
    span.error = err
  },
  endSpan: () => {},
}
```

## Disabling tracing

Omit the `tracer` option (or set it to `undefined`) and the client does no
tracing work and pays no per-operation overhead - the hooks compile down to
a couple of `undefined` checks on the hot path.
