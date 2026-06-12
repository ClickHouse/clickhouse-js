# Transport benchmark: `http`/`https` vs `fetch`

---

This benchmark provides reproducible numbers for the proposal in
[#418](https://github.com/ClickHouse/clickhouse-js/issues/418): replacing the
legacy `node:http` / `node:https` transport used by `@clickhouse/client` with
`fetch` (backed by `undici`).

It compares `@clickhouse/client` **as built from this repository** (resolved via
the npm workspace symlink, which uses `http`/`https` internally) against a
**trivial `fetch()`-based stub** over the exact same HTTP requests, so the
difference reflects raw transport cost rather than client-side parsing or
configuration.

Three representative use cases are measured:

1. **Single-request latency** — many small sequential `SELECT 1` requests.
2. **Download throughput** — streaming a large result set and draining it.
3. **Upload throughput** — `POST`ing a large insert body to the `null()` table
   function (data is discarded server-side, so no table setup is required).

For each case the report prints throughput (where applicable) and per-request
latency distribution (`min`/`mean`/`p50`/`p90`/`p99`/`max`).

## Run it

All commands assume you are in the repository root.

Start a local ClickHouse instance (the default `docker-compose.yml` works):

```sh
docker-compose up -d
```

The benchmark drives `@clickhouse/client` through the compiled workspace package
(`packages/client-node/dist`), so build the workspace packages first, then run
the benchmark with `tsx`:

```sh
# 1. Build the workspace packages so `@clickhouse/client` resolves at runtime.
npm run build

# 2. Run the benchmark.
npx tsx benchmarks/transport/index.ts
```

`tsx` only transpiles at startup; it is not in the timing loop, so it does not
affect these network-bound measurements (per-request latency and large-result
throughput).

### Configuration

All parameters are optional and provided via environment variables:

- `CLICKHOUSE_URL` — server URL (default: `http://localhost:8123`)
- `LATENCY_REQUESTS` — number of sequential `SELECT 1` requests (default: `200`)
- `DOWNLOAD_ROWS` — rows in the download result set (default: `1000000`)
- `UPLOAD_ROWS` — rows in the upload body (default: `1000000`)
- `ITERATIONS` — measured iterations for the throughput scenarios (default: `10`)
- `WARMUP` — warmup iterations excluded from the results (default: `3`)

Example with custom configuration:

```sh
npm run build \
&& LATENCY_REQUESTS=500 DOWNLOAD_ROWS=5000000 ITERATIONS=20 \
npx tsx benchmarks/transport/index.ts
```

## Sample results

Indicative numbers from a single local run (macOS / Apple Silicon,
Node.js v24.6.0, ClickHouse `head`, `docker-compose` single node, loopback
networking, **default configuration**: `LATENCY_REQUESTS=200
DOWNLOAD_ROWS=1000000 UPLOAD_ROWS=1000000 ITERATIONS=10 WARMUP=3`). **Reproduce
on your own hardware before drawing conclusions** — absolute values are
environment-specific.

| Scenario                  | `@clickhouse/client` (http/https) | `fetch` (undici) stub |
| ------------------------- | --------------------------------- | --------------------- |
| `SELECT 1` latency (mean) | ~2.3 ms                           | ~0.8 ms               |
| Download throughput       | ~1000–1250 MiB/s                  | ~227 MiB/s            |
| Upload throughput         | ~205–222 MiB/s                    | ~211–224 MiB/s        |

In this run `fetch` had markedly lower small-request latency (~3× faster), while
the existing `http`/`https` streaming path drained large result sets
considerably faster (~4.5–5.5×), and upload throughput was effectively
server-bound for both transports. This is exactly the kind of trade-off the
benchmark is meant to surface — the right transport choice depends on the
workload, so measure the scenarios that matter to you.

## Interpreting the results

- Run against a **local** server to minimise network noise; for a more
  realistic picture, also run it against a remote/cloud endpoint via
  `CLICKHOUSE_URL`.
- The `fetch` stub intentionally omits everything the real client does (request
  settings, retries, keep-alive tuning, compression, abort handling, logging).
  It is a transport baseline, **not** a drop-in replacement, so treat it as the
  best case for a `fetch`/`undici` migration.
- Numbers vary by machine, Node.js version, and ClickHouse version. Always
  capture `process.version` (printed in the header) alongside the results when
  sharing them.
