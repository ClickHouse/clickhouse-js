# OTEL phase 2: trace context propagation to the ClickHouse server

This document analyzes the OpenTelemetry (OTEL) support implemented in
[`ClickHouse/clickhouse-go`](https://github.com/ClickHouse/clickhouse-go) (the official Go client)
and lays out a plan for bringing the equivalent capability to `clickhouse-js`.

It builds on the phase-1 work already merged into this repository: the zero-dependency
[`ClickHouseTracer`](packages/client-common/src/tracing.ts) interface and the client-side spans
created in [`packages/client-common/src/client.ts`](packages/client-common/src/client.ts).

## 1. What clickhouse-go actually implements

**Key finding: clickhouse-go does _not_ create any OTEL spans of its own.** There are no calls to
`tracer.Start()`, `otel.Tracer()`, `span.RecordError()`, `span.SetStatus()`, or any other
span-lifecycle API anywhere in the codebase, and no tracer provider configuration. Its OTEL support
is exclusively **one-way trace context propagation**: the caller hands the driver an existing
`trace.SpanContext`, and the driver serializes it into the query it sends to the server.

### 1.1 Spans

None. No per-query, per-connection, per-batch, or ping spans.

### 1.2 Span attributes

None. No `db.system`, `db.statement`, `server.address`, query-id attributes, or any `semconv`
usage. (Everything in this category that exists in `clickhouse-js` today — see §2 — already goes
_beyond_ what clickhouse-go offers.)

### 1.3 Error recording / span status

None. Errors are logged via Go's `slog`, never recorded on a span.

### 1.4 Tracer configuration

None. The only OTEL dependency is `go.opentelemetry.io/otel/trace`, imported purely for the
`trace.SpanContext` **type**. The user creates the span context externally (with any OTEL SDK, or
manually via `trace.NewSpanContext(...)`).

### 1.5 Trace context propagation (the one feature it has)

| Aspect              | clickhouse-go behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public API          | `clickhouse.Context(ctx, clickhouse.WithSpan(spanCtx))` — `WithSpan(trace.SpanContext)` stores the span context in per-query `QueryOptions` (`context.go`).                                                                                                                                                                                                                                                                                                                                   |
| Native TCP protocol | `conn_send_query.go` copies `QueryOptions.span` into `proto.Query.Span`; `lib/proto/query.go` (`encodeClientInfo`) serializes it into the `client_info` section of the `ClientQuery` packet when the server revision is ≥ `DBMS_MIN_REVISION_WITH_OPENTELEMETRY` (54442): a 1-byte `has_trace` flag, 16-byte TraceID, 8-byte SpanID (both byte-swapped per 8-byte chunk to match the server's endianness, see ClickHouse#34369), the W3C `tracestate` string, and a 1-byte trace-flags value. |
| HTTP protocol       | **Not supported.** `conn_http.go` ignores `QueryOptions.span`; no `traceparent`/`tracestate` headers and no `opentelemetry_trace_parent` parameter are ever sent.                                                                                                                                                                                                                                                                                                                             |
| Server-side effect  | The server records the propagated trace/span IDs in `system.opentelemetry_span_log` (and `system.query_log`), parenting its own per-query and query-stage spans under the client's trace.                                                                                                                                                                                                                                                                                                     |
| Examples/tests      | `examples/clickhouse_api/open_telemetry.go`, `examples/std/open_telemetry.go`, `tests/opentelemetry_test.go`.                                                                                                                                                                                                                                                                                                                                                                                 |

## 2. Where clickhouse-js stands today (phase 1)

`clickhouse-js` already implements everything clickhouse-go is _missing_, via the optional
`tracer` config (`packages/client-common/src/tracing.ts`, wired into
`packages/client-common/src/client.ts`):

- Client-side spans for every tracked operation: `clickhouse.query`, `clickhouse.command`,
  `clickhouse.exec`, `clickhouse.insert`, `clickhouse.ping` (`ClickHouseSpanNames`), all with
  `SpanKind.CLIENT`.
- Attributes: `db.system: "clickhouse"`, `server.address`, `db.namespace`, optional
  `clickhouse.application`, plus per-operation `clickhouse.format`, `clickhouse.query_id`,
  `clickhouse.session_id`.
- Error recording: `recordSpanError` calls `span.recordException(...)` and sets
  `SpanStatusCode.ERROR`; successful operations set `SpanStatusCode.OK`; `span.end()` is called
  exactly once.
- No-op tracer (`NoopClickHouseTracer`) assigned at client creation; a raw
  `trace.getTracer(...)` from `@opentelemetry/api` is assignable as-is.

What `clickhouse-js` does **not** do yet is the one thing clickhouse-go _does_ do: **propagate the
trace context to the ClickHouse server**, so that the server's own spans (recorded in
`system.opentelemetry_span_log`) join the application's distributed trace.

## 3. Plan: server-side trace context propagation for clickhouse-js

`clickhouse-js` talks to ClickHouse over HTTP only, which makes this much simpler than
clickhouse-go's binary encoding: the ClickHouse HTTP interface natively accepts the W3C
[Trace Context](https://www.w3.org/TR/trace-context/) headers `traceparent` and `tracestate`
(see the ClickHouse [OpenTelemetry tracing guide](https://clickhouse.com/docs/guides/oss/deployment-and-scaling/monitoring/opentelemetry)).
The server parses them, uses the client trace ID as the parent for its query spans, and respects
the sampled flag.

### 3.1 Design decisions

1. **Keep the zero-dependency posture.** Like phase 1 (and like clickhouse-go, which only uses the
   `SpanContext` type), the client must not import `@opentelemetry/api`. The user supplies the
   trace context; the client only serializes it.
2. **Model the API on clickhouse-go's `WithSpan`, adapted to JS idioms.** clickhouse-go takes an
   explicit `trace.SpanContext` per query. The JS equivalent is a per-request option carrying the
   already-formatted W3C header values, plus an optional client-level provider for the common
   "derive it from the current active span" case.
3. **Headers, not query-string settings.** Send standard `traceparent`/`tracestate` HTTP headers.
   This matches the W3C recommendation, works identically for the Node and Web connections, and
   avoids touching `ClickHouseSettings`.
4. **Structural types over OTEL types.** Mirror the phase-1 approach: define a tiny
   `ClickHouseTraceContext` shape (`{ traceparent: string; tracestate?: string }`) so users can
   produce it from `@opentelemetry/api` (`span.spanContext()` → format `traceparent` as
   `00-<traceId>-<spanId>-<flags as 2 hex digits>`) or from any other source.

### 3.2 Implementation steps

1. **`client-common`: types and plumbing.**
   - Add `ClickHouseTraceContext` to `packages/client-common/src/tracing.ts` (exported from the
     package index, re-exported from `client-node` and `client-web` like the other tracing types,
     using the established `import { X as X_ }` re-export pattern).
   - Add an optional `trace_context?: ClickHouseTraceContext | (() => ClickHouseTraceContext | undefined)`
     to `BaseQueryParams` (per-request) and a `trace_context?: () => ClickHouseTraceContext | undefined`
     provider to `BaseClickHouseClientConfigOptions` (client-level default, evaluated per request —
     the function form is what lets an OTEL user return the _current_ active span's context).
   - Resolve the effective trace context in `withClientQueryParams` (request value wins over the
     client-level provider) and pass it down through the connection params for `query`, `insert`,
     `command`, `exec`, and `ping`.
   - Validate/normalize: silently skip propagation when the resolved value is `undefined`, and
     reject malformed `traceparent` values (wrong segment count/lengths, all-zero trace or span
     id) rather than sending garbage headers.
2. **Connections: header injection.**
   - `packages/client-node/src/connection/node_base_connection.ts`: when a trace context is
     present on the request params, add `traceparent` (and `tracestate` if set) to the outgoing
     request headers, after the user-provided `http_headers` so propagation cannot be silently
     clobbered. Per AGENTS.md, implement this independently in
     `packages/client-web/src/connection/web_connection.ts` rather than hoisting a shared helper —
     this duplication is intentional.
3. **Tie it into phase-1 spans (the integration sweet spot).**
   - Document (and demonstrate in the example) the recommended OTEL setup: pass
     `tracer: trace.getTracer(...)` **and** a `trace_context` provider that reads
     `trace.getActiveSpan()?.spanContext()`. Because phase-1 operations run inside
     `startActiveSpan`, the propagated context is the client operation span itself — so the
     server's spans in `system.opentelemetry_span_log` become children of `clickhouse.query` /
     `clickhouse.insert` / etc.
4. **Tests.**
   - Unit tests (both packages): header is present/absent/correctly formatted; per-request
     override beats the client-level provider; malformed `traceparent` is rejected; web tests use
     an injected mocked `fetch`.
   - Integration test: run a query with a fixed `traceparent` and assert the trace ID appears in
     `system.opentelemetry_span_log` (with `SYSTEM FLUSH LOGS`), mirroring clickhouse-go's
     `tests/opentelemetry_test.go`.
5. **Examples and docs.**
   - Extend `examples/node/coding/otel_tracing.ts` (and add a Web counterpart) to show end-to-end
     propagation with the OTEL SDK; gate it from examples CI until the feature is released (the
     examples package installs `@clickhouse/client@latest` from npm).
   - Add a `docs/` page describing trace propagation, server prerequisites
     (`opentelemetry_span_log` enabled, `opentelemetry_start_trace_probability`), and how to query
     `system.opentelemetry_span_log`.
   - Update `CHANGELOG.md` under the unreleased version heading (`## New features`).

### 3.3 Explicitly out of scope

- **Native TCP protocol encoding** (clickhouse-go's `encodeClientInfo` byte-swapping dance):
  irrelevant for an HTTP-only client.
- **Bundling an OTEL SDK or auto-detecting the active span**: would break the zero-dependency
  rule; the provider-function pattern covers it in user land with three lines of code.
- **Metrics/logs signals**: clickhouse-go has none either; tracing only.

## 4. Summary comparison

| Capability                          | clickhouse-go            | clickhouse-js today | clickhouse-js after this plan |
| ----------------------------------- | ------------------------ | ------------------- | ----------------------------- |
| Client-side spans                   | ❌                       | ✅ (5 operations)   | ✅                            |
| Span attributes (semconv + custom)  | ❌                       | ✅                  | ✅                            |
| Error recording / span status       | ❌                       | ✅                  | ✅                            |
| Trace context propagation to server | ✅ (native TCP only)     | ❌                  | ✅ (W3C HTTP headers)         |
| Propagation over HTTP               | ❌ (silently ignored)    | ❌                  | ✅                            |
| OTEL dependency required            | type-only (`otel/trace`) | none                | none                          |
