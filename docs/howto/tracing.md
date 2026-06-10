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
  startActiveSpan<T>(
    name: string,
    options: ClickHouseSpanOptions,
    fn: (span: TSpan) => T,
  ): T;
}

interface ClickHouseSpan {
  setAttributes(attributes: ClickHouseSpanAttributes): void;
  setStatus(status: ClickHouseSpanStatus): void; // { code: number; message?: string }
  recordException(error: Error): void;
  end(): void;
}
```

- `startActiveSpan` has the same shape as OTEL's
  `Tracer.startActiveSpan(name, options, fn)` overload; the options carry
  `kind` (always `ClickHouseSpanKind.CLIENT`, value-identical to OTEL's
  `SpanKind.CLIENT`, per the OTEL database semantic conventions) and the
  initial `attributes`. Implementations must invoke `fn` with the new span
  and return `fn`'s result untouched - the client runs the entire operation
  (an `async` function) inside `fn`.
- The span only needs the four methods above; OTEL's `Span` satisfies them
  as-is (its chainable `this`-returning methods are compatible with the
  `void` declarations).
- Status codes are numbers, value-identical to OTEL's `SpanStatusCode`.
  Non-OTEL implementations can match on the exported
  `ClickHouseSpanStatusCode` constant (`UNSET: 0`, `OK: 1`, `ERROR: 2`).

### Active-span context propagation

Because the client's operation callback is asynchronous (the span is used
across `await` points inside `fn`), OpenTelemetry needs the
`AsyncLocalStorageContextManager` (from `@opentelemetry/context-async-hooks`)
to keep the ClickHouse operation span _active_ for the duration of the
request - that is what causes auto-instrumented child spans (e.g. from
`@opentelemetry/instrumentation-http`) to be parented under it.

**This context manager is the default in the OpenTelemetry Node.js SDK**
(`@opentelemetry/sdk-node` / `NodeTracerProvider`), so if you use the
standard SDK setup, no extra work is needed. With a bare
`BasicTracerProvider` (e.g. in tests), register it manually:

```ts
import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
```

A complete, runnable version of this setup (wired to an in-memory span
exporter so you can see the emitted spans) lives in
[`examples/node/coding/otel_tracing.ts`](../../examples/node/coding/otel_tracing.ts).

## When the tracer is called

For every call to `query` / `command` / `exec` / `insert` / `ping` (with the
single exception of `insert` with an empty `values` array, which short-circuits
before talking to the server), the client invokes
`startActiveSpan(name, { kind, attributes }, fn)`:

1. The name is one of `clickhouse.query`, `clickhouse.command`,
   `clickhouse.exec`, `clickhouse.insert`, `clickhouse.ping` (also exported
   as `ClickHouseSpanNames`); `kind` is `ClickHouseSpanKind.CLIENT`. The
   initial attribute bag always includes `db.system`, `db.namespace`,
   `server.address`, and - when set - `clickhouse.application`, plus
   operation-specific entries such as `clickhouse.format`,
   `clickhouse.table`, `clickhouse.query_id`, and `clickhouse.session_id`.
2. Inside `fn`, the network operation runs with the span as the active span
   (when the context manager supports it; see above).
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
  startActiveSpan: (name, options, fn) => {
    const span: RecordedSpan = {
      name,
      attributes: { ...options.attributes },
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
    return fn(span);
  },
};
```

## Disabling tracing

Omit the `tracer` option (or set it to `undefined`) and the client does no
tracing work - a shared no-op tracer (handing out a shared no-op span) is
assigned once at client creation, so the hot path stays branch-free with
effectively zero per-operation overhead, and the monomorphic call sites
remain friendly to the JIT.
