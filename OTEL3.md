# OTEL3: what we can inherit from `@julr/otel-instrumentation-clickhouse`

Source reviewed: <https://github.com/Julien-R44/otel-instrumentation-clickhouse>
(commit `ec86643`, package `@julr/otel-instrumentation-clickhouse`, Apache 2.0).

It is a third-party OpenTelemetry _auto-instrumentation_ for `@clickhouse/client` /
`@clickhouse/client-web` `>=1.0.0`. It monkey-patches `ClickHouseClient.prototype`
(`query`, `insert`, `command`, `exec`) via `@opentelemetry/instrumentation`
(`InstrumentationBase` + `InstrumentationNodeModuleDefinition` targeting the
`@clickhouse/client-common` module).

## How it compares to our built-in tracing

We already have a first-party, dependency-free hook in `client-common`:

- `ClickHouseTracer` / `ClickHouseSpan` (`packages/client-common/src/tracing.ts`) — a
  structural subset of the OTEL `Tracer`/`Span` API, so `trace.getTracer(...)` is
  assignable as-is via `createClient({ tracer })`.
- The client wraps `query`/`command`/`exec`/`insert`/`ping` in
  `tracer.startActiveSpan(...)` (`packages/client-common/src/client.ts`), sets
  `db.system`, `server.address`, `db.namespace`, `clickhouse.application`, plus
  per-operation `clickhouse.format` / `clickhouse.query_id` / `clickhouse.session_id` /
  `clickhouse.table` / `clickhouse.ping.select`, records exceptions, and ends the span.

Being inside the client, we have strictly better information than the wrapper (e.g. the
server-generated `query_id` after the request, the parsed connection params, `ping`).
So the patching machinery itself is not interesting; their **conventions and options**
are.

## Worth inheriting

1. **Stable DB semantic-convention attributes (semconv ≥ 1.26).** They emit the new
   stable names alongside the deprecated ones:

   | Stable               | Deprecated (we currently emit)                |
   | -------------------- | --------------------------------------------- |
   | `db.system.name`     | `db.system`                                   |
   | `db.operation.name`  | `db.operation` (we emit neither)              |
   | `db.query.text`      | `db.statement` (we emit neither)              |
   | `db.namespace`       | `db.name` (we already emit `db.namespace` ✅) |
   | `db.collection.name` | — (we emit custom `clickhouse.table`)         |

   Action: emit `db.system.name: "clickhouse"` (keep `db.system` for one release for
   compatibility), add `db.operation.name` (`query` / `insert` / `command` / `exec` /
   `ping` — trivially derivable from `ClickHouseSpanNames`), and emit
   `db.collection.name` next to `clickhouse.table` on `insert`.

2. **`server.address` / `server.port` split.** They set `server.address = url.hostname`
   and `server.port` as a number. We currently set `server.address = url.host`
   (host **+ port**), which deviates from semconv. Action: switch to `hostname` and add
   `server.port`.

3. **Span naming with the collection: `clickhouse.<op> <table>`.** Semconv recommends
   `{db.operation.name} {target}` for low-cardinality span names. We can do this
   reliably (without their regex SQL parsing) for `insert`, where `params.table` is
   explicit: `clickhouse.insert <table>`.

4. **`db.query.text` capture with a `maxQueryLength` truncation option (default 2048,
   `0` disables).** We deliberately don't attach SQL today. An **opt-in**
   tracing config option (off by default — query text can contain sensitive literals)
   with whitespace normalization (`/\s+/g → ' '`) and truncation marker (`...`) is a
   good, proven shape. Their `query` field is available before we hand off to the
   connection, so this fits our existing `withBaseSpanAttributes` flow.

5. **`requireParentSpan` option.** Skip span creation when there is no active parent
   span — useful to suppress noise from health checks/background pings. In our design
   this belongs in the _adapter/tracer implementation_ (it can check
   `trace.getSpan(context.active())` and call `fn` with a noop span), not in the
   client; worth documenting in `examples/node/coding/otel_tracing.ts` rather than
   adding a client option.

6. **`suppressInternalInstrumentation` (default `true`).** They wrap the original call
   in `context.with(suppressTracing(context.active()), ...)` so
   `@opentelemetry/instrumentation-http` doesn't emit a duplicate child HTTP span per
   ClickHouse request. We can't do this in the client (no OTEL dependency), but the
   OTEL example/docs should show users how to apply `suppressTracing` inside their
   tracer adapter, or how to configure the http instrumentation's `ignoreOutgoingRequestHook`
   for the ClickHouse endpoint.

7. **Explicit `OK` status on success.** They set `SpanStatusCode.OK` on success — we
   already do this ✅ (and we additionally update `clickhouse.query_id` post-request,
   which they cannot).

## Not worth inheriting

- **The monkey-patching/`InstrumentationBase` machinery** — superseded by the built-in
  `tracer` config option; first-party hooks are more robust than prototype patching
  (which also breaks if methods become non-prototype or the package is bundled).
- **Regex-based table-name extraction from raw SQL** (`FROM`/`INSERT INTO`/`UPDATE`/
  `DELETE` patterns) — best-effort, wrong for JOINs/CTEs/subqueries, and high
  maintenance. Only emit `db.collection.name` where the table is structurally known
  (`insert`).
- **Their `UPDATE`/`DELETE` SQL branches** — not ClickHouse dialect anyway
  (`ALTER TABLE ... UPDATE/DELETE`).
- **Promise-vs-sync result sniffing** (`result.then === 'function'`) — unnecessary in
  first-party code where all instrumented methods are `async`.
- **A dependency on `@opentelemetry/instrumentation`/`@opentelemetry/api`** — keeping
  `client-common` dependency-free is a core design constraint of our tracer interface.

## Suggested follow-ups (in order)

1. ✅ **Implemented.** Add stable semconv attributes (`db.system.name`, `db.operation.name`,
   `db.collection.name`) and fix `server.address`/`server.port`. Since the tracer API is
   still unreleased, the old keys (`db.system`, `clickhouse.table`, host+port in
   `server.address`) were removed outright instead of being kept for a deprecation window.
2. Add opt-in query-text capture (`db.query.text`) behind a tracing option with
   `maxQueryLength`-style truncation; default off.
3. Use `clickhouse.insert <table>` as the insert span name.
4. ✅ **Implemented.** Extend `examples/node/coding/otel_tracing.ts` (and
   `docs/howto/tracing.md`) with `requireParentSpan` and `suppressTracing` adapter
   recipes so the third-party package's two config options have first-party equivalents.
