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
   initial attribute bag always includes `db.system.name`, `db.namespace`,
   `server.address`, and `server.port`, and - when set -
   `clickhouse.application`, plus operation-specific entries such as
   `clickhouse.response.format` (query), `clickhouse.request.format`,
   `db.operation.name`, `db.collection.name` and `clickhouse.request.sent_rows`
   (insert; the row count is recorded for array-based inserts only),
   `clickhouse.request.query_id`, and
   `clickhouse.request.session_id`.
2. Inside `fn`, the network operation runs with the span as the active span
   (when the context manager supports it; see above).
3. `span.setAttributes({ 'clickhouse.request.query_id': <server-assigned id> })` -
   so you always have the final `query_id`, even when the caller did not pass
   one and the connection layer generated it. Once the response arrives, the
   span also gets `db.response.status_code` (HTTP status) and, when the
   `X-ClickHouse-Summary` header is present (e.g. with `wait_end_of_query`),
   `clickhouse.summary.*` counters (`read_rows`, `written_rows`, …).
4. On success, the span status is left **unset**, per the OTEL span status
   spec for client spans. On failure,
   `span.setAttributes({ 'error.type': <error class name> })` (plus
   `clickhouse.error.code` with the numeric server error code when the error
   is a server-side `ClickHouseError`), then `span.recordException(error)`
   immediately followed by
   `span.setStatus({ code: ClickHouseSpanStatusCode.ERROR, message })`.
   Non-`Error` throwables are normalized to `Error` before `recordException`.
5. `span.end()` - exactly once. For `command`/`exec`/`insert`/`ping`, in a
   `finally` block when the method settles; for `query`, when the returned
   `ResultSet` is fully consumed, closed, or fails (see the stream lifecycle
   note below).

Tracer calls are inlined directly on the client's hot path and are **not**
wrapped in defensive try/catch - if your tracer or span throws, the exception
propagates to the caller of `query` / `command` / `exec` / `insert` /
`ping`. Make sure your tracer implementation doesn't throw.

> **Stream lifecycle:** for `query`, the span stays open for the entire
> `ResultSet` lifetime, mirroring clickhouse-rs (where the span lives as long
> as the cursor). The span ends - with the final response metrics
> `clickhouse.response.decoded_bytes` and, for row-streaming consumption,
> `db.response.returned_rows` - when the result set is fully consumed
> (`text()`/`json()` resolve, or the `stream()` is read to completion),
> closed via `close()`, or fails (the streaming error is recorded on the
> span). If the `ResultSet` is never consumed nor closed, the span is never
> ended. For `command`/`exec`/`insert`/`ping`, the span ends when the method
> returns.

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

## Trace context propagation (`traceparent`)

To let the ClickHouse server link its own spans (recorded in
`system.opentelemetry_span_log`) to your client trace, the outgoing requests
must carry the W3C `traceparent` / `tracestate` headers. With OpenTelemetry,
this happens automatically: Node.js users get header propagation for free
from `@opentelemetry/instrumentation-http` (Web: `instrumentation-fetch`),
since the client uses the platform HTTP stack. With the
`AsyncLocalStorageContextManager` registered (see above), those
auto-instrumented HTTP spans parent under the `clickhouse.<operation>` span,
so the injected `traceparent` points at the client trace.

To see the server-side spans, the server must have the
`opentelemetry_span_log` table configured (see this repository's
`.docker/clickhouse/single_node/config.xml` for an example); you can then
correlate by trace id:

```sql
SELECT * FROM system.opentelemetry_span_log
WHERE lower(hex(trace_id)) = '<your 32-char trace id>'
```

## Disabling tracing

Omit the `tracer` option (or set it to `undefined`) and the client will not emit any spans. Internally, it uses a shared no-op tracer/span so the call sites remain monomorphic (branch-free), keeping the overhead minimal (but not strictly zero).
