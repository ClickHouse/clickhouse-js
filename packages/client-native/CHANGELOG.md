# 0.1.0

## New features

- Initial release of `@clickhouse/client-native`: a zero-dependency Node.js client that uses ClickHouse's native TCP protocol (`tcp://host:9000`, `tcps://host:9440`) while keeping the public API of `@clickhouse/client`:
  - Supports `query`, `command`, `insert`, `exec`, and `ping`, with connection pooling, idle-socket eviction, `ClientPacket.Cancel` on abort/timeout/early stream close, TLS / mutual TLS, query parameters, ClickHouse settings (including `wait_end_of_query`), and `AbortSignal`.
  - Decodes ClickHouse column types (including `Variant`, `Dynamic`, and `JSON` wire forms; excluding `AggregateFunction`, `QBit`, and `Object('json')`), preserving raw bytes for non-UTF-8 `String` values and nested server exception chains (`error.cause`).
  - Formats `Native` blocks into `JSON*`, `CSV*`, and `TabSeparated*` outputs matching the HTTP interface byte-for-byte, with direct `Native`-to-JSON object construction for `ResultSet.json()`, fast-path binary-to-JSON row text writers, and accurate UTF-8 / block-byte tracing metrics (`clickhouse.response.decoded_bytes`).
  - Encodes JSON-format row arrays and streams as `Native` blocks (honoring server `DEFAULT`, null, `format_json_object_each_row_column_for_object_name`, and custom JSON serializer settings), and sends raw non-JSON formats (`CSV`, `TabSeparated`, `Parquet`, etc.) without extra payload copies for server-side parsing.
  - Supports bidirectional `lz4` and `zstd` block compression (`compression: "lz4" | "zstd" | { codec: "lz4" } | { codec: "zstd", level }`) with incremental compressed-frame consumption and CityHash128 v1.0.2 in WebAssembly (with a JavaScript fallback).

## Improvements

- Scope `system.settings` caching per server identity with a 5-minute TTL, preserve healthy sockets on `getServerSettings` aborts and transient errors, and guard `loadServerSettings` warnings with `log_level`.
- Add per-packet backpressure in `NativeSocket.parse()`, incremental compressed-frame consumption, zero-copy `Buffer[]` query framing for inline payloads, `ClientPacket.Cancel` on early close/abort/timeout, and hot-loop optimizations in `compareBytes`, `readJSON` (columnar `JSONObjectValue` and direct JS object construction without `JSON.parse`), `encodeRows` (direct array batching, zero-`Buffer` string encoding, safe-integer 64-bit encoding, and zero-object `DateTime` parsing), `readStrings`, `readInts`, `Tuple`, `Log` skipping, and bounded `TimeZoneOffsets`.
- Validate client-level `session_id`, `role`, and HTTP compression URL parameters eagerly at `createClient()`, assign distinct `query_id`s across split `insert()` statements, and support 64-bit `VarUInt` progress counters with fast-fail wire length bounds.

## Bug fixes

- Prevent `Object.prototype` pollution and key loss in `ValueWriter.pathsToTree()` and `parseColumnType()` lookup tables.
- Guard `writeDynamic()` against blocks with 255 or more distinct types (falling back to server parsing), write the dummy byte per row for empty `Tuple()` inserts, and fix `columnsWithDefaults` backtick parsing, `JSONObjectEachRow` key preservation, `JSONCompact` text fallback format, `target.columns` rewrite guard, and `Tuple`/`Map` normalization errors.
- Tighten binary wire validation in `readLowCardinality` (including `LowCardinality(Nullable(Enum))` slot 0), `readOffsets`, `readVariant`, and `readDynamic`, isolate `Log`/`ProfileEvents` from `ctx.raw_bytes`, snapshot `DecodeContext` for lazy binary columns, and return server error text from `exec({ ignore_error_response: true, values })`.
