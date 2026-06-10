# Tracing the ClickHouse client with the `tracer` API

`@clickhouse/client` (and `@clickhouse/client-web`) ships a small,
**zero-dependency** `tracer` configuration option you can use to plug the
client's per-operation lifecycle into any tracing or metrics backend - most
notably [OpenTelemetry](https://opentelemetry.io/), but also Prometheus
counters, a plain `EventEmitter`, or your own logger.

The tracer surface lives entirely inside the client (no extra packages on
`npm install`, nothing to add to your bundle). It is declared as a
**structural subset of the OpenTelemetry `Tracer`/`Span` APIs**, so a raw
OTEL tracer can be passed to the client **as-is** - no adapter, no casts:

```ts
import { createClient } from "@clickhouse/client";
import { trace } from "@opentelemetry/api";

const client = createClient({
  url: "http://localhost:8123",
  tracer: trace.getTracer("@clickhouse/client"),
});
```

## Why a structural subset instead of a built-in dependency

OpenTelemetry's full Node.js distribution (`@opentelemetry/sdk-node` +
`@opentelemetry/sdk-metrics`) adds several megabytes of dependencies on top of
the ~500&nbsp;KB OpenTelemetry API package (`@opentelemetry/api`) and is
undesirable for many users. The client therefore ships **only the type
shapes**, declared so that OTEL's real `Tracer` and `Span` satisfy them
structurally - and users who don't want tracing pay nothing for it, on disk
or at runtime.

## Tracer surface

```ts
import type {
  ClickHouseTracer,
  ClickHouseSpan,
  ClickHouseSpanOptions,
  ClickHouseSpanAttributes,
  ClickHouseSpanStatus,
} from "@clickhouse/client"; // or '@clickhouse/client-web'

interface ClickHouseTracer<TSpan extends ClickHouseSpan = ClickHouseSpan> {
  startSpan(name: string, options?: ClickHouseSpanOptions): TSpan;
  withActiveSpan?<T>(span: TSpan, fn: () => T): T;
}

interface ClickHouseSpan {
  setAttributes(attributes: ClickHouseSpanAttributes): void;
  setStatus(status: ClickHouseSpanStatus): void; // { code: number; message?: string }
  recordException(error: Error): void;
  end(): void;
}
```

- `startSpan` has the same shape as the first two parameters of OTEL's
  `Tracer.startSpan`; the options carry `kind` (always
  `ClickHouseSpanKind.CLIENT`, value-identical to OTEL's `SpanKind.CLIENT`,
  per the OTEL database semantic conventions) and the initial `attributes`.
- The returned span only needs the four methods above; OTEL's `Span`
  satisfies them as-is (its chainable `this`-returning methods are compatible
  with the `void` declarations).
- Status codes are numbers, value-identical to OTEL's `SpanStatusCode`.
  Non-OTEL implementations can match on the exported
  `ClickHouseSpanStatusCode` constant (`UNSET: 0`, `OK: 1`, `ERROR: 2`).

### Optional: active-span context propagation

`withActiveSpan` is optional, and a raw OTEL tracer does not have it. When
defined, the client runs the underlying network operation inside this scope
function, so an OTEL implementation can make the ClickHouse operation span
the _active_ span for the duration of the request - causing auto-instrumented
child spans (e.g. from `@opentelemetry/instrumentation-http`) to be parented
under it. The function is synchronous - `fn` returns the operation's
`Promise`, which must be returned untouched:

```ts
import { createClient, type ClickHouseTracer } from "@clickhouse/client";
import { context, trace, type Span } from "@opentelemetry/api";

const otelTracer = trace.getTracer("@clickhouse/client");

const tracer: ClickHouseTracer<Span> = {
  startSpan: (name, options) => otelTracer.startSpan(name, options),
  withActiveSpan: (span, fn) =>
    context.with(trace.setSpan(context.active(), span), fn),
};

const client = createClient({ url: "http://localhost:8123", tracer });
```

A complete, runnable version of this setup (wired to an in-memory span
exporter so you can see the emitted spans) lives in
[`examples/node/coding/otel_tracing.ts`](../../examples/node/coding/otel_tracing.ts).

## When the tracer is called

For every call to `query` / `command` / `exec` / `insert` / `ping` (with the
single exception of `insert` with an empty `values` array, which short-circuits
before talking to the server), the client invokes:

1. `startSpan(name, { kind, attributes })` - the name is one of
   `clickhouse.query`, `clickhouse.command`, `clickhouse.exec`,
   `clickhouse.insert`, `clickhouse.ping` (also exported as
   `ClickHouseSpanNames`); `kind` is `ClickHouseSpanKind.CLIENT`. The initial
   attribute bag always includes `db.system`, `db.namespace`,
   `server.address`, and - when set - `clickhouse.application`, plus
   operation-specific entries such as `clickhouse.format`,
   `clickhouse.table`, `clickhouse.query_id`, and `clickhouse.session_id`.
2. If `withActiveSpan` is defined, the network operation runs inside it.
3. `span.setAttributes({ 'clickhouse.query_id': <server-assigned id> })` - so
   you always have the final `query_id`, even when the caller did not pass one
   and the connection layer generated it.
4. `span.setStatus({ code: ClickHouseSpanStatusCode.OK })` on success, or
   `span.recordException(error)` immediately followed by
   `span.setStatus({ code: ClickHouseSpanStatusCode.ERROR, message })` on
   failure. Non-`Error` throwables are normalized to `Error` before
   `recordException`.
5. `span.end()` - always, in a `finally` block.

Tracer calls are inlined directly on the client's hot path and are **not**
wrapped in defensive try/catch - if your tracer or span throws, the exception
propagates to the caller of `query` / `command` / `exec` / `insert` /
`ping`. Make sure your tracer implementation doesn't throw.

> **Stream lifecycle:** for `query`/`exec`, the span ends when the request
> promise settles (i.e. headers received, stream handed to the caller). The
> client does not currently emit a separate "download finished" span when the
> returned `ResultSet` stream is fully consumed; if you need that, wrap the
> stream on the caller side.

## Recording-only tracer for tests / debugging

```ts
import {
  ClickHouseSpanStatusCode,
  type ClickHouseSpan,
  type ClickHouseSpanStatus,
  type ClickHouseTracer,
} from "@clickhouse/client";

interface RecordedSpan extends ClickHouseSpan {
  name: string;
  attributes: Record<string, unknown>;
  status?: ClickHouseSpanStatus;
  error?: Error;
}

const recorded: RecordedSpan[] = [];
const tracer: ClickHouseTracer<RecordedSpan> = {
  startSpan: (name, options) => {
    const span: RecordedSpan = {
      name,
      attributes: { ...options?.attributes },
      setAttributes: (attrs) => Object.assign(span.attributes, attrs),
      setStatus: (status) => {
        span.status =
          status.code === ClickHouseSpanStatusCode.UNSET ? undefined : status;
      },
      recordException: (err) => {
        span.error = err;
      },
      end: () => {},
    };
    recorded.push(span);
    return span;
  },
};
```

## Disabling tracing

Omit the `tracer` option (or set it to `undefined`) and the client does no
tracing work - operations run against a shared no-op span singleton, so the
hot path stays branch-free with effectively zero per-operation overhead.
