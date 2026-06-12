import { attachExceptionHandlers } from "../common";
import {
  SdkTransportClient,
  UndiciTransportClient,
  type TransportClient,
} from "./clients";
import {
  latencyStats,
  mibs,
  ms,
  throughputMiBs,
  type LatencyStats,
} from "./stats";

/*
 * Transport benchmark: `@clickhouse/client` (legacy `http`/`https`) vs a trivial
 * `undici.request()` stub.
 *
 * Motivation: https://github.com/ClickHouse/clickhouse-js/issues/418 proposes
 * replacing the legacy `http`/`https` modules with `fetch`/`undici`. We compare
 * against `undici.request()` rather than the global `fetch()` deliberately:
 * `request()` returns a native Node `Readable`, while `fetch()` routes the body
 * through the much slower WebStreams layer (nodejs/undici#1203), which would
 * unfairly handicap the transport a real migration would adopt. Before
 * committing to such a change we want trustworthy, reproducible numbers for a
 * few representative use cases. This benchmark provides exactly that: an
 * apples-to-apples comparison over the same HTTP requests against a local
 * ClickHouse instance.
 *
 * Scenarios:
 *   1. Single-request latency  - many small sequential `SELECT 1` requests.
 *   2. Download throughput     - streaming a large result set and draining it.
 *   3. Upload throughput       - POSTing a large insert body to `null()`.
 *
 * Run instructions and caveats are documented in README.md.
 */

const url = process.env["CLICKHOUSE_URL"] ?? "http://localhost:8123";
const latencyRequests = intEnv("LATENCY_REQUESTS", 200);
const downloadRows = intEnv("DOWNLOAD_ROWS", 1_000_000);
const uploadRows = intEnv("UPLOAD_ROWS", 1_000_000);
const iterations = intEnv("ITERATIONS", 10);
const warmup = intEnv("WARMUP", 3);

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid value for ${name}: ${raw}`);
  }
  return parsed;
}

interface ThroughputResult {
  totalBytes: number;
  elapsedMs: number;
  throughput: number;
  perRequest: LatencyStats;
}

async function benchLatency(client: TransportClient): Promise<LatencyStats> {
  for (let i = 0; i < warmup; i++) {
    await client.query("SELECT 1 FORMAT TabSeparated");
  }
  const durations: number[] = [];
  for (let i = 0; i < latencyRequests; i++) {
    const start = performance.now();
    await client.query("SELECT 1 FORMAT TabSeparated");
    durations.push(performance.now() - start);
  }
  return latencyStats(durations);
}

async function benchDownload(
  client: TransportClient,
): Promise<ThroughputResult> {
  const query = `SELECT number FROM system.numbers LIMIT ${downloadRows} FORMAT TabSeparated`;
  for (let i = 0; i < warmup; i++) {
    await client.query(query);
  }
  const durations: number[] = [];
  let totalBytes = 0;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const reqStart = performance.now();
    totalBytes += await client.query(query);
    durations.push(performance.now() - reqStart);
  }
  const elapsedMs = performance.now() - start;
  return {
    totalBytes,
    elapsedMs,
    throughput: throughputMiBs(totalBytes, elapsedMs),
    perRequest: latencyStats(durations),
  };
}

async function benchUpload(client: TransportClient): Promise<ThroughputResult> {
  const query = `INSERT INTO FUNCTION null('n UInt64') FORMAT TabSeparated`;
  const body = buildInsertBody(uploadRows);
  const bodyBytes = Buffer.byteLength(body);
  for (let i = 0; i < warmup; i++) {
    await client.insert(query, body);
  }
  const durations: number[] = [];
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const reqStart = performance.now();
    await client.insert(query, body);
    durations.push(performance.now() - reqStart);
  }
  const elapsedMs = performance.now() - start;
  const totalBytes = bodyBytes * iterations;
  return {
    totalBytes,
    elapsedMs,
    throughput: throughputMiBs(totalBytes, elapsedMs),
    perRequest: latencyStats(durations),
  };
}

function buildInsertBody(rows: number): string {
  const lines = new Array<string>(rows);
  for (let i = 0; i < rows; i++) {
    lines[i] = String(i);
  }
  return lines.join("\n") + "\n";
}

function logLatency(label: string, stats: LatencyStats): void {
  console.log(
    `  ${label.padEnd(10)} samples=${stats.samples} ` +
      `min=${ms(stats.min)} mean=${ms(stats.mean)} ` +
      `p50=${ms(stats.p50)} p90=${ms(stats.p90)} p99=${ms(stats.p99)} ` +
      `max=${ms(stats.max)}`,
  );
}

function logThroughput(label: string, result: ThroughputResult): void {
  const mib = (result.totalBytes / (1024 * 1024)).toFixed(2);
  console.log(
    `  ${label.padEnd(10)} ${mibs(result.throughput)} ` +
      `(${mib} MiB in ${ms(result.elapsedMs)})`,
  );
  logLatency("per-req", result.perRequest);
}

async function run(): Promise<void> {
  attachExceptionHandlers();

  console.log(
    "Transport benchmark: @clickhouse/client (http/https) vs undici.request()",
  );
  console.log("Configuration:");
  console.log(`  url:              ${url}`);
  console.log(`  latencyRequests:  ${latencyRequests}`);
  console.log(`  downloadRows:     ${downloadRows}`);
  console.log(`  uploadRows:       ${uploadRows}`);
  console.log(`  iterations:       ${iterations}`);
  console.log(`  warmup:           ${warmup}`);
  console.log(`  node:             ${process.version}`);
  console.log();

  const clients: TransportClient[] = [
    new SdkTransportClient(url),
    new UndiciTransportClient(url),
  ];

  try {
    for (const client of clients) {
      console.log(`=== ${client.name} ===`);

      console.log("[latency] sequential SELECT 1");
      logLatency("latency", await benchLatency(client));

      console.log("[download] streaming large result set");
      logThroughput("download", await benchDownload(client));

      console.log("[upload] POST large insert body");
      logThroughput("upload", await benchUpload(client));

      console.log();
    }
  } finally {
    for (const client of clients) {
      await client.close();
    }
  }
}

void run().then(() => process.exit(0));
