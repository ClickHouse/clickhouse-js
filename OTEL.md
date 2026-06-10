# OpenTelemetry alignment plan: clickhouse-rs → clickhouse-js

This document analyzes the OpenTelemetry (OTEL) spans and attributes implemented in the Rust
client, [`ClickHouse/clickhouse-rs`](https://github.com/ClickHouse/clickhouse-rs), compares them
with the current `clickhouse-js` tracer implementation
([`packages/client-common/src/tracing.ts`](packages/client-common/src/tracing.ts),
[`packages/client-common/src/client.ts`](packages/client-common/src/client.ts)), and lays out a
plan for converging on the same span names and attribute vocabulary.

Both clients follow the
[OTEL database semantic conventions for SQL](https://opentelemetry.io/docs/specs/semconv/db/sql/),
with ClickHouse-specific extension attributes under the `clickhouse.*` namespace. `clickhouse-rs`
notes in its source that ClickHouse-specific semantic conventions are still a `TODO` upstream; this
plan treats the Rust client's vocabulary as the de-facto convention to align with.

## 1. What clickhouse-rs implements

### 1.1 Architecture

- Instrumentation is built on the [`tracing`](https://docs.rs/tracing) facade. Spans are created
  unconditionally at `INFO` level; an optional `opentelemetry` Cargo feature gates the
  OTEL-specific fields (`otel.kind`, `otel.status_code`, `error.type`, `db.system.name`) so they
  are not emitted as log noise when the feature is off.
- Fields that are `Empty`/`None` are not reported; most response-side attributes are declared
  `Empty` at span creation and recorded later (`tracing::record_all!`).
- **Span status is never set to `OK` on success** — it is only set to `Error` when an error occurs,
  matching the OTEL spec recommendation that instrumentation leave the status unset for successful
  client spans.
- **Spans outlive the request call**: cursors (`RowCursor`, `BytesCursor`) hold the span and keep
  entering it while streaming; final response metrics are recorded when the cursor is dropped.

### 1.2 Spans

| Span name           | Created in                          | Covers                                                                   |
| ------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| `clickhouse.query`  | `src/query.rs` (`make_span`)        | `execute()`, `fetch()`/`fetch_*()` and the entire cursor lifetime        |
| `clickhouse.insert` | `src/insert_formatted.rs`           | The whole `INSERT` lifecycle (`Insert`/`InsertFormatted`), until `end()` |
| `response`          | `src/response.rs` (`Response::new`) | Child span around awaiting/streaming the HTTP response                   |

### 1.3 Attributes

#### `clickhouse.query` span

| Attribute                            | When set         | Value                                                                                                                                                                                   |
| ------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `otel.kind`                          | creation         | `"client"` (only with `opentelemetry` feature)                                                                                                                                          |
| `otel.status_code`                   | on error         | `"Error"` (left unset on success)                                                                                                                                                       |
| `otel.status_description`            | on error         | `"<context msg>: <error display>"`                                                                                                                                                      |
| `error.type`                         | on error         | Error variant name (e.g. `Network`, `BadResponse`, `TimedOut`), per the [OTEL `error.type` registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/error/#error-type) |
| `db.system.name`                     | creation         | `"clickhouse"` (only with `opentelemetry` feature)                                                                                                                                      |
| `db.query.text`                      | —                | Commented out / TODO (intended only at TRACE verbosity)                                                                                                                                 |
| `db.query.summary`                   | —                | Declared `Empty`, TODO (generated query summary)                                                                                                                                        |
| `db.response.status_code`            | response headers | HTTP status code (recorded in `collect_response`)                                                                                                                                       |
| `db.response.returned_rows`          | cursor drop      | Rows decoded by `RowCursor`                                                                                                                                                             |
| `clickhouse.request.session_id`      | creation         | `session_id` setting, if set                                                                                                                                                            |
| `clickhouse.request.query_id`        | creation         | `query_id` setting, if set                                                                                                                                                              |
| `clickhouse.response.received_bytes` | cursor drop      | Network (possibly compressed) bytes received                                                                                                                                            |
| `clickhouse.response.decoded_bytes`  | cursor drop      | Decompressed bytes                                                                                                                                                                      |
| `clickhouse.response.format`         | creation         | Response format (e.g. `RowBinaryWithNamesAndTypes`)                                                                                                                                     |

#### `clickhouse.insert` span

Everything from the conventional set above (`otel.*`, `error.type`, `db.system.name`,
`db.query.summary`), plus:

| Attribute                          | When set    | Value                                          |
| ---------------------------------- | ----------- | ---------------------------------------------- |
| `db.operation.name`                | creation    | `"INSERT"`                                     |
| `db.collection.name`               | creation    | Target table name                              |
| `clickhouse.request.session_id`    | creation    | `session_id` setting, if set                   |
| `clickhouse.request.query_id`      | creation    | `query_id` setting, if set                     |
| `clickhouse.request.sent_rows`     | `end()`     | Rows serialized (typed `Insert` only)          |
| `clickhouse.request.sent_bytes`    | termination | Bytes sent over the wire (possibly compressed) |
| `clickhouse.request.encoded_bytes` | termination | Bytes before compression                       |

#### `response` (child) span

| Attribute                 | When set | Value              |
| ------------------------- | -------- | ------------------ |
| `otel.status_code`        | on error | `"Error"`          |
| `otel.status_description` | on error | Error description  |
| `error.type`              | on error | Error variant name |
| `db.response.status_code` | headers  | HTTP status code   |

### 1.4 Error recording

`Error::record_in_current_span()` (`src/error.rs`) is invoked at every failure point (request
build, response await, decompression, in-band `DB::Exception` detection in the body stream, row
deserialization), setting `otel.status_code = "Error"`, `otel.status_description`, and
`error.type` on the current span, plus a `tracing::debug!` event (which `tracing-opentelemetry`
exports as an OTEL span event).

### 1.5 Trace context propagation

`src/headers.rs` injects the W3C trace context (`traceparent` / `tracestate`) into the outgoing
HTTP request headers via `opentelemetry::global::get_text_map_propagator` (gated behind the
`opentelemetry` feature). This lets the ClickHouse server adopt the client's trace context and
record matching server-side spans in `system.opentelemetry_span_log` — the integration test
(`tests/it/opentelemetry.rs`) asserts that the server-side span's query ID matches the client's.

## 2. What clickhouse-js implements today

The client ships a zero-dependency `tracer` config option (`ClickHouseTracer` /
`ClickHouseSpan`, a structural subset of OTEL's `Tracer`/`Span`; see
[`docs/howto/tracing.md`](docs/howto/tracing.md)). The client itself decides the span names and
attributes:

| Span name            | Covers                                                 |
| -------------------- | ------------------------------------------------------ |
| `clickhouse.query`   | `client.query()` up to response headers / stream start |
| `clickhouse.command` | `client.command()`                                     |
| `clickhouse.exec`    | `client.exec()`                                        |
| `clickhouse.insert`  | `client.insert()`                                      |
| `clickhouse.ping`    | `client.ping()`                                        |

Attributes (set via `withBaseSpanAttributes` and per-operation extras):

| Attribute                | clickhouse-rs equivalent        | Notes                           |
| ------------------------ | ------------------------------- | ------------------------------- |
| `db.system`              | `db.system.name`                | js uses the **old** semconv key |
| `server.address`         | — (not set by rs)               | OTEL-conventional, keep         |
| `db.namespace`           | — (not set by rs)               | OTEL-conventional, keep         |
| `clickhouse.application` | —                               | js-specific, keep               |
| `clickhouse.query_id`    | `clickhouse.request.query_id`   | naming mismatch                 |
| `clickhouse.session_id`  | `clickhouse.request.session_id` | naming mismatch                 |
| `clickhouse.format`      | `clickhouse.response.format`    | naming mismatch                 |
| `clickhouse.table`       | `db.collection.name`            | naming mismatch                 |
| `clickhouse.ping.select` | — (rs has no ping)              | js-specific, keep               |

Behavioral differences vs. clickhouse-rs:

1. **`setStatus(OK)` on success** — rs (and the OTEL spec) leave the status unset on success.
2. **No `error.type` attribute** — errors are recorded via `span.recordException()` +
   `setStatus(ERROR)` only.
3. **No response-side attributes** — `db.response.status_code`, `db.response.returned_rows`,
   `clickhouse.response.received_bytes` / `decoded_bytes` are not recorded.
4. **No request-side insert metrics** — `clickhouse.request.sent_rows` / `sent_bytes` /
   `encoded_bytes` are not recorded.
5. **No `db.operation.name` / `db.collection.name`** on the insert span.
6. **Span ends when the client method returns** — for `query()`, the span ends before the
   `ResultSet` stream is consumed, so streaming time and row/byte counts are invisible. rs keeps
   the span alive for the entire cursor lifetime.
7. **No trace context propagation** — the client does not inject `traceparent`/`tracestate` into
   the HTTP request, so the ClickHouse server cannot link its `opentelemetry_span_log` entries to
   the client trace (unless `@opentelemetry/instrumentation-http` happens to be installed and does
   it for the underlying Node.js request).

## 3. Implementation plan

The plan is ordered so that each phase is independently shippable. All work happens in
`packages/client-common` (shared), with the streaming pieces touching `client-node` and
`client-web` result sets. Per repository convention, node/web connection-level duplication is
acceptable and should not be hoisted into `client-common` beyond platform-agnostic primitives.

### Phase 1 — attribute vocabulary alignment (non-breaking additions)

Align attribute names with clickhouse-rs while keeping the existing keys for one release cycle
(documented as deprecated), since the tracer API is already published:

- Add `db.system.name: "clickhouse"` alongside the existing `db.system` (modern semconv key used
  by rs); deprecate and later remove `db.system`.
- Rename `clickhouse.query_id` → `clickhouse.request.query_id` and `clickhouse.session_id` →
  `clickhouse.request.session_id` (emit both during the deprecation window).
- Rename `clickhouse.format` → `clickhouse.response.format` on `query`; for `insert`, the format
  describes the request payload, so use `clickhouse.request.format` (a js-specific extension —
  rs's `InsertFormatted` embeds the format in SQL and does not record it).
- On the `insert` span, add `db.operation.name: "INSERT"` and `db.collection.name: <table>`
  (alongside the existing `clickhouse.table` during the deprecation window).
- Stop calling `setStatus({ code: OK })` on success; leave the status unset like rs and the OTEL
  spec recommend. Keep `setStatus(ERROR)` + `recordException` on failure.
- Add `error.type` on failures in `recordSpanError` (`packages/client-common/src/tracing.ts`):
  use the error class name (`ClickHouseError`, `ConnectionError`, `TimeoutError`, `Error`, …) and,
  for server-side `ClickHouseError`, the numeric server error code as
  `clickhouse.error.code` (js extension; rs encodes its own error enum variants instead).
- Document the canonical attribute table in `docs/howto/tracing.md` and update
  `examples/node/coding/otel_tracing.ts` assertions.

### Phase 2 — response-side attributes

- Record `db.response.status_code` (HTTP status) on every span once response headers arrive. The
  connection layer already surfaces `response_headers`; extend the connection results (node and
  web independently) to expose the HTTP status code so `client.ts` can set it.
- For `query()`, record `db.response.returned_rows`, `clickhouse.response.received_bytes` and
  `clickhouse.response.decoded_bytes` when the `ResultSet` is fully consumed or closed. This
  requires the span lifetime change below.
- Where the `X-ClickHouse-Summary` header is available (`command`/`exec`/`insert` with
  `wait_end_of_query`, or response headers in general), optionally map summary counters
  (`read_rows`, `written_rows`, …) to `clickhouse.summary.*` attributes (js extension; rs parses
  the same header into `QuerySummary` but does not yet record it on spans).

### Phase 3 — span lifetime over streaming (query)

Mirror rs's "span lives as long as the cursor" model:

- Pass the active span into `makeResultSet` (node and web result sets separately, per the
  duplication convention). The span is ended when the stream is fully consumed, destroyed, or
  errors — not when `query()` returns.
- Count decoded rows and received bytes inside the result set while streaming, then record
  `db.response.returned_rows` / `clickhouse.response.received_bytes` /
  `clickhouse.response.decoded_bytes` right before `span.end()`.
- Errors surfaced during streaming (e.g. in-band `DB::Exception` parsing) call `recordSpanError`
  on the still-open span — this fixes today's blind spot where streaming failures are invisible
  to tracing.
- Keep `command`/`exec`/`insert`/`ping` ending the span on method return (their responses are
  fully consumed by then), matching current behavior.

### Phase 4 — insert request metrics

- Record `clickhouse.request.sent_rows` for array-based inserts (known up front) and counted
  during encoding for streamed inserts where rows are countable (e.g. `JSONEachRow` encoding in
  `valuesEncoder`).
- Record `clickhouse.request.sent_bytes` (bytes written to the socket, post-compression) and
  `clickhouse.request.encoded_bytes` (pre-compression) from the node connection's request body
  pipeline; web `fetch` cannot observe post-compression size, so the web client records
  `encoded_bytes` only (document this divergence as "Node.js only" in the CHANGELOG).

### Phase 5 — trace context propagation

- Add an optional `propagateTraceContext` hook to the tracer surface (or a standalone
  `http_headers`-producing callback in the client config) that lets the user inject
  `traceparent`/`tracestate` into outgoing requests — keeping the zero-dependency stance: the
  client never imports `@opentelemetry/api` itself, the user wires
  `propagation.inject(context.active(), headers)` in the hook.
- Document the alternative: Node.js users can get propagation for free from
  `@opentelemetry/instrumentation-http` (web: `instrumentation-fetch`), since the client uses the
  platform HTTP stack; with the `AsyncLocalStorageContextManager`, those auto-instrumented HTTP
  spans already parent under the `clickhouse.*` span.
- Add an integration test mirroring rs's `tests/it/opentelemetry.rs`: run a query with a known
  `query_id`, then assert `system.opentelemetry_span_log` contains a server span whose trace ID
  matches the client span (requires `opentelemetry_span_log` enabled in the docker-compose server
  config, as rs does in `.docker/clickhouse/single_node/config.xml`).

### Out of scope / intentionally divergent

- rs's separate child `response` span: js keeps a single span per operation; the response phase is
  visible via `db.response.status_code` timing and (with auto-instrumentation) the nested HTTP
  span. Revisit only if users ask for it.
- `db.query.text` / `db.query.summary`: rs has both as TODO (text only at TRACE verbosity due to
  PII/cardinality concerns). Track them, but do not implement before rs settles the convention.
- rs records final cursor metrics on `Drop`; js cannot rely on GC, hence the explicit
  consumed/destroyed/error hooks in Phase 3.

### Cross-cutting tasks (every phase)

- Update `docs/howto/tracing.md` and `examples/node/coding/otel_tracing.ts` (and the web example
  when applicable).
- Add/extend unit tests in `packages/client-common/__tests__` using a recording fake tracer
  (`createSimpleTestClient` keeps these server-free).
- Add a CHANGELOG entry under the unreleased version heading, marking Node-only behavior
  explicitly.
