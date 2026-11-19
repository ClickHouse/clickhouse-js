# 0.1.0

## New features

- Initial release of `@clickhouse/client-native`: a zero-dependency Node.js client that uses ClickHouse's native TCP protocol (`tcp://host:9000`, `tcps://host:9440`) while keeping the public API of `@clickhouse/client`:
  - Supports `query`, `command`, `insert`, `exec`, and `ping`, with connection pooling, TLS / mutual TLS, query parameters, ClickHouse settings, and `AbortSignal`.
  - Decodes ClickHouse column types (including `Variant`, `Dynamic`, and `JSON` wire forms; excluding `AggregateFunction`, `QBit`, and `Object('json')`), preserving raw bytes for non-UTF-8 `String` values.
  - Formats `Native` blocks into `JSON*`, `CSV*`, and `TabSeparated*` outputs matching the HTTP interface byte-for-byte, with direct `Native`-to-JSON object construction for `ResultSet.json()` and fast-path binary-to-JSON row text writers.
  - Encodes JSON-format row arrays and streams as `Native` blocks (honoring server `DEFAULT`, null, and custom JSON serializer settings), and streams raw non-JSON formats (`CSV`, `TabSeparated`, `Parquet`, etc.) for server-side parsing.
  - Supports bidirectional `lz4` and `zstd` block compression (`compression: "lz4" | "zstd"`) with CityHash128 v1.0.2 in WebAssembly and a JavaScript fallback.
