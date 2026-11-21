# Native TCP vs HTTP Performance & Resource Suite

Compares `@clickhouse/client` (HTTP) and `@clickhouse/client-native` (native TCP protocol), plus an optional baseline `@clickhouse/client-native` build (`NATIVE_BEFORE_MODULE`) for before/after regression tracking.

For every scenario, the suite captures:

- **Throughput & latency** (`req/s`, `rows/s`, or `MiB/s`, plus `mean`, `p50`, `p99`)
- **Node.js CPU** (`process.cpuUsage()` user + system ms per op and CPU utilization %)
- **V8 JS heap allocations** (`node:inspector/promises` `HeapProfiler.startSampling` in a separate post-timing pass so profiler overhead never affects latency, including short-lived objects collected by minor and major GC)
- **Peak memory deltas** (`process.memoryUsage()` peak `heapUsed` and `arrayBuffers` / `Buffer` delta above a post-GC baseline)
- **GC pressure** (`PerformanceObserver` on `"gc"` count and total pause duration)

Run with `NODE_OPTIONS="--expose-gc"` for clean post-GC memory baselines between targets.

## Scenarios

1. `point_latency` — sequential `SELECT 1` point lookups (low-latency TCP framing vs HTTP).
2. `concurrent_queries` — 16 concurrent pooled workers issuing small queries.
3. `select_json_objects` — 100k-row `JSONEachRow` `.json()` read (direct `ResultChunk.rows()` vs HTTP JSON serialization + `JSON.parse`).
4. `select_stream_rows` — 200k-row `JSONEachRow` `.stream()` read (`BinaryJSONRows` fast path + per-packet backpressure).
5. `select_compressed` — 200k-row compressed `.json()` read (native LZ4 + incremental compressed-frame consumption vs HTTP gzip).
6. `insert_json_rows` — 100k-row structured `JSONEachRow` insert (columnar Native blocks + LZ4 vs HTTP JSON + gzip).
7. `insert_raw_csv_stream` — 1M-row (~25 MiB) multi-chunk raw `CSV` stream insert (zero-copy `Buffer[]` query framing vs HTTP streaming, with heap/buffer delta).
8. `select_complex_types` — 50k-row query with `Tuple`, `Array`, `JSON`, and `DateTime('Europe/Berlin')` (exercises indexed `Tuple` decoding, `readInts`, and bounded `TimeZoneOffsets`).
9. `select_json_paths` — 50k-row `JSON` query using path-based Native serialization (`output_format_native_write_json_as_string = 0`, 8 keys/row; exercises zero-allocation `compareBytes` and `readJSON` pre-sorted paths).
10. `cancel_heavy_query` — early `ResultSet.close()` on a 50M-row query followed by a recovery `SELECT 1` (`ClientPacket.Cancel`).

## Running

Build the workspace packages first so both `@clickhouse/client` and `@clickhouse/client-native` resolve from `dist/`:

```sh
npm run build
npx tsx benchmarks/native/index.ts
```

### Before vs After Comparison

To compare the current working tree against a previous git commit (for example `HEAD`), check out the baseline commit in a temporary worktree, build it, and pass its `dist/index.js` via `NATIVE_BEFORE_MODULE`:

```sh
git worktree add /tmp/ch-native-before HEAD
npm --prefix /tmp/ch-native-before/packages/client-native run build

NATIVE_BEFORE_MODULE=/tmp/ch-native-before/packages/client-native/dist/index.js \
npx tsx benchmarks/native/index.ts

git worktree remove /tmp/ch-native-before
```

### Environment Variables

- `CLICKHOUSE_HTTP_URL` (default: `http://127.0.0.1:8123`)
- `CLICKHOUSE_NATIVE_URL` (default: `tcp://127.0.0.1:9000`)
- `NATIVE_BEFORE_MODULE` — optional path to baseline `@clickhouse/client-native` `dist/index.js`
- `SCENARIOS` — comma-separated subset of scenario names to run
- `ITERATIONS` (default: `7`), `WARMUP` (default: `2`)
- `LATENCY_REQUESTS` (default: `200`), `CONCURRENCY` (default: `16`), `CONCURRENT_PER_WORKER` (default: `25`)
- `SELECT_JSON_ROWS` (default: `100000`), `SELECT_STREAM_ROWS` (default: `200000`), `COMPRESSED_ROWS` (default: `200000`)
- `INSERT_JSON_ROWS` (default: `100000`), `INSERT_CSV_ROWS` (default: `200000`), `COMPLEX_ROWS` (default: `50000`)
