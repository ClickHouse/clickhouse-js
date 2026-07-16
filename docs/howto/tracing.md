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
   `clickhouse.request.session_id`. Any per-request
   [`span_attributes`](#enriching-spans-with-span_attributes) and, when
   [`dangerously_log_query_text`](#logging-the-raw-query-text) is enabled, the
   raw SQL as `db.query.text` are merged into this initial bag too.
2. Inside `fn`, the network operation runs with the span as the active span
   (when the context manager supports it; see above).
3. `span.setAttributes({ 'clickhouse.request.query_id': <server-assigned id> })` -
   so you always have the final `query_id`, even when the caller did not pass
   one and the connection layer generated it. Once the response arrives, the
   span also gets `db.response.status_code` (HTTP status) and, when the
   `X-ClickHouse-Summary` header is present (e.g. with `wait_end_of_query`),
   the `clickhouse.summary.*` counters. **Every** key present in the parsed
   summary is recorded (the set is not hardcoded), so you get `read_rows`,
   `read_bytes`, `written_rows`, `written_bytes`, `result_rows`,
   `result_bytes`, `total_rows_to_read`, `elapsed_ns`, and — on servers that
   report them — `memory_usage` (peak query memory, in bytes),
   `real_time_microseconds`, and any future server-side additions for free.
   These counters are attached to every operation span, including the outer
   `clickhouse.query` span.
4. On success, the span status is left **unset**, per the OTEL span status
   spec for client spans. On failure,
   `span.setAttributes({ 'error.type': <error class name> })` (plus
   `clickhouse.error.code` with the numeric server error code when the error
   is a server-side `ClickHouseError`), then `span.recordException(error)`
   immediately followed by
   `span.setStatus({ code: ClickHouseSpanStatusCode.ERROR, message })`.
   Non-`Error` throwables are normalized to `Error` before `recordException`.
5. `span.end()` - exactly once. For `command`/`exec`/`insert`/`ping`, in a
   `finally` block when the method settles; for `query`, see the stream
   lifecycle note below.

Tracer calls are inlined directly on the client's hot path and are **not**
wrapped in defensive try/catch - if your tracer or span throws, the exception
propagates to the caller of `query` / `command` / `exec` / `insert` /
`ping`. Make sure your tracer implementation doesn't throw.

> **Stream lifecycle:** `query()` emits **two spans**.
>
> - `clickhouse.query` — covers the HTTP request: starts when `query()` is
>   called and ends as soon as the response headers arrive (regardless of how
>   much data is in the body).
> - `clickhouse.query.stream` — a child span that covers the `ResultSet`
>   lifetime: starts immediately after the response headers are received and
>   ends when the result set is fully consumed (`text()`/`json()` resolve, or
>   the `stream()` is read to completion), closed via `close()`, or fails
>   (the error is recorded on this span). When it ends it carries the final
>   `clickhouse.response.decoded_bytes` and `db.response.returned_rows`
>   metrics. `returned_rows` is recorded both for row-streaming consumption
>   (`stream()`, and `json()` on the streamable JSON formats) and for
>   non-streaming `json()` on `JSON` / `JSONObjectEachRow` / the other
>   single-document JSON formats.
>
> This split makes it easy to distinguish the original request round-trip from
> a stream that may never end (e.g. tailing a live materialized view). If the
> `ResultSet` is never consumed nor closed, the `clickhouse.query.stream` span
> is never ended. For `command`/`exec`/`insert`/`ping`, a single span ends
> when the method returns.

## Enriching spans with `span_attributes`

Every request method (`query` / `command` / `exec` / `insert` / `ping`)
accepts an optional `span_attributes` bag that is merged into the operation
span. This is the recommended way to attach application-level context to your
traces — for example, mirroring the tags you also send to ClickHouse via the
[`log_comment`](https://clickhouse.com/docs/operations/settings/settings#log_comment)
setting so the same context is visible both in `system.query_log` and in your
tracing backend:

```ts
const tag = {
  route: "events.getAgentGraphData",
  tenant: "acme",
  surface: "api",
};

await client.query({
  query: "SELECT * FROM events WHERE tenant = {tenant:String}",
  query_params: { tenant: tag.tenant },
  // Visible in ClickHouse's system.query_log
  clickhouse_settings: { log_comment: JSON.stringify(tag) },
  // Visible on the tracing span
  span_attributes: {
    "app.route": tag.route,
    "app.tenant": tag.tenant,
    "app.surface": tag.surface,
  },
});
```

Values may be `string`, `number`, or `boolean`. Caller-provided attributes
**never override** the client's own semantic-convention attributes (`db.*`,
`server.*`, `clickhouse.*`) on a key collision. `span_attributes` are ignored
when no tracer is configured.

## Logging the raw query text

By default the client **never** attaches the raw SQL to spans or logs, because
a statement can contain sensitive data inlined as literals. Set
`dangerously_log_query_text: true` at client creation to opt in:

```ts
const client = createClient({
  tracer: trace.getTracer("clickhouse-js"),
  dangerously_log_query_text: true,
});
```

When enabled, the raw SQL is attached to every operation span as the OTEL
[`db.query.text`](https://opentelemetry.io/docs/specs/semconv/database/database-spans/#common-attributes)
attribute, and (Node.js) included in the `error`-level log emitted when a
request fails. Bound `query_params` values and credentials are **never** logged
or traced, regardless of this setting.

## Adapter recipes: `requireParentSpan` and suppressing nested HTTP spans

OpenTelemetry auto-instrumentation packages commonly expose two options that
the client deliberately does **not** implement itself - both belong in a thin
tracer adapter, where they compose with your OTEL setup:

### Only trace when there is an active parent span

Skip ClickHouse spans when nothing else is being traced (e.g. background
health checks or pings outside any request context). Wrap the tracer and
hand the client a no-op span when there is no active parent:

```ts
import { context, trace } from "@opentelemetry/api";
import {
  createClient,
  type ClickHouseSpan,
  type ClickHouseTracer,
} from "@clickhouse/client";

const noop = () => undefined;
const noopSpan: ClickHouseSpan = {
  setAttributes: noop,
  setStatus: noop,
  recordException: noop,
  end: noop,
};

const otelTracer = trace.getTracer("@clickhouse/client");
const tracer: ClickHouseTracer = {
  startActiveSpan: (name, options, fn) =>
    trace.getSpan(context.active()) === undefined
      ? fn(noopSpan) // no active parent span - do not trace this operation
      : otelTracer.startActiveSpan(name, options, fn),
};

const client = createClient({ tracer });
```

### Suppress nested HTTP spans

If `@opentelemetry/instrumentation-http` is registered, every ClickHouse
operation span gets a duplicate child HTTP span for the underlying request.
To suppress them, run the operation under a suppressed context using
`suppressTracing` from `@opentelemetry/core`:

```ts
import { context, trace } from "@opentelemetry/api";
import { suppressTracing } from "@opentelemetry/core";
import { createClient, type ClickHouseTracer } from "@clickhouse/client";

const otelTracer = trace.getTracer("@clickhouse/client");
const tracer: ClickHouseTracer = {
  startActiveSpan: (name, options, fn) =>
    otelTracer.startActiveSpan(name, options, (span) =>
      context.with(suppressTracing(context.active()), () => fn(span)),
    ),
};

const client = createClient({ tracer });
```

Alternatively, keep the raw tracer and configure the HTTP instrumentation to
ignore requests to your ClickHouse endpoint via its
`ignoreOutgoingRequestHook` option.

Both recipes are demonstrated end-to-end in
[`examples/node/coding/otel_tracing.ts`](../../examples/node/coding/otel_tracing.ts).

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
