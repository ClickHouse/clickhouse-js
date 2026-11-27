import { createClient as createHttpClient } from "@clickhouse/client";
import type { ClickHouseClient as HttpClient } from "@clickhouse/client";
import { createClient as createNativeClient } from "@clickhouse/client-native";
import type { ClickHouseClient as NativeClient } from "@clickhouse/client-native";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import { attachExceptionHandlers } from "../common";
import { mibs, ms, type LatencyStats } from "../transport/stats";
import {
  AllocationSampler,
  formatBytes,
  formatCpuMs,
  formatMiB,
  formatReduction,
  maybeGC,
  measureIterations,
  type ResourceMetrics,
} from "./metrics";

/*
 * Native TCP vs HTTP performance & resource suite.
 *
 * Compares `@clickhouse/client` (HTTP), `@clickhouse/client-native` (current),
 * and optionally a baseline `@clickhouse/client-native` build passed via
 * `NATIVE_BEFORE_MODULE` across workloads where users choose the native TCP
 * protocol over HTTP — capturing throughput, latency percentiles, Node.js CPU,
 * V8 JS heap allocations, peak heap & Buffer memory, and GC pressure:
 *
 *   1. point_latency         - sequential small `SELECT 1` point lookups
 *   2. concurrent_queries    - pooled concurrent point queries (16 workers)
 *   3. select_json_objects   - large `JSONEachRow` `.json()` analytics read
 *   4. select_stream_rows    - large `JSONEachRow` `.stream()` row streaming
 *   5. select_compressed     - large compressed read (LZ4 native vs gzip HTTP)
 *   6. insert_json_rows      - structured `JSONEachRow` batch insert (LZ4 vs gzip)
 *   7. insert_raw_csv_stream - raw multi-chunk CSV stream insert via `insert()`
 *   8. select_complex_types  - Tuple, Array, JSON, DateTime('Europe/Berlin')
 *   9. select_json_paths     - JSON binary paths (8 keys/row, path sorting)
 *  10. cancel_heavy_query    - early `ResultSet.close()` + follow-up recovery
 */

const httpUrl = process.env["CLICKHOUSE_HTTP_URL"] ?? "http://127.0.0.1:8123";
const nativeUrl =
  process.env["CLICKHOUSE_NATIVE_URL"] ?? "tcp://127.0.0.1:9000";
const beforeModulePath = process.env["NATIVE_BEFORE_MODULE"];
const latencyRequests = intEnv("LATENCY_REQUESTS", 200);
const concurrency = intEnv("CONCURRENCY", 16);
const concurrentPerWorker = intEnv("CONCURRENT_PER_WORKER", 25);
const selectJsonRows = intEnv("SELECT_JSON_ROWS", 100_000);
const selectStreamRows = intEnv("SELECT_STREAM_ROWS", 200_000);
const compressedRows = intEnv("COMPRESSED_ROWS", 200_000);
const insertJsonRows = intEnv("INSERT_JSON_ROWS", 100_000);
const insertCsvRows = intEnv("INSERT_CSV_ROWS", 1_000_000);
const complexRows = intEnv("COMPLEX_ROWS", 50_000);
const jsonPathsRows = intEnv("JSON_PATHS_ROWS", 50_000);
const iterations = intEnv("ITERATIONS", 7);
const warmup = intEnv("WARMUP", 2);
const scenarioFilter = process.env["SCENARIOS"]
  ? new Set(
      process.env["SCENARIOS"]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
  : undefined;

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid value for ${name}: ${raw}`);
  }
  return parsed;
}

type AnyClient = HttpClient | NativeClient;

interface TargetFactory {
  readonly id: "http" | "native-before" | "native-after";
  readonly label: string;
  createPlain(): AnyClient;
  createCompressed(): AnyClient;
}

interface ScenarioMetrics {
  scenario: string;
  target: TargetFactory["id"];
  label: string;
  stats: LatencyStats;
  /** Primary rate (higher is better): req/s, rows/s, or MiB/s. */
  rate: number;
  rateUnit: "req/s" | "rows/s" | "MiB/s";
  /** Unit label for per-op CPU and allocations (e.g. "req" or "100k"). */
  opLabel: string;
  resources: ResourceMetrics;
}

async function loadBeforeCreateClient(
  modulePath: string,
): Promise<typeof createNativeClient> {
  const resolved = path.resolve(modulePath);
  try {
    const req = createRequire(path.join(process.cwd(), "package.json"));
    const loaded = req(resolved) as {
      createClient?: typeof createNativeClient;
    };
    if (typeof loaded.createClient === "function") {
      return loaded.createClient;
    }
  } catch {
    // Fall back to ESM dynamic import if needed.
  }
  const loaded = (await import(pathToFileURL(resolved).href)) as {
    createClient?: typeof createNativeClient;
  };
  if (typeof loaded.createClient !== "function") {
    throw new Error(
      `NATIVE_BEFORE_MODULE (${modulePath}) does not export createClient`,
    );
  }
  return loaded.createClient;
}

function buildJsonInsertRows(count: number): Array<{
  id: number;
  grp: number;
  score: number;
  tag: string;
  ts: string;
}> {
  const rows = new Array<{
    id: number;
    grp: number;
    score: number;
    tag: string;
    ts: string;
  }>(count);
  for (let i = 0; i < count; i++) {
    rows[i] = {
      id: i,
      grp: i % 100,
      score: (i % 10_000) * 0.25,
      tag: `item_${i % 1000}`,
      ts: "2024-06-15 12:34:56",
    };
  }
  return rows;
}

function buildCsvChunks(
  count: number,
  chunkLines = 4096,
): { chunks: Buffer[]; totalBytes: number } {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for (let start = 0; start < count; start += chunkLines) {
    const end = Math.min(start + chunkLines, count);
    const lines = new Array<string>(end - start);
    for (let i = start; i < end; i++) {
      lines[i - start] =
        `${i},${i % 100},"item_${i % 1000}",${(i % 1000) * 0.5}`;
    }
    const buf = Buffer.from(lines.join("\n") + "\n");
    chunks.push(buf);
    totalBytes += buf.length;
  }
  return { chunks, totalBytes };
}

async function runPointLatency(
  target: TargetFactory,
  sampler: AllocationSampler,
): Promise<ScenarioMetrics> {
  const client = target.createPlain();
  try {
    const runOne = async () => {
      const rs = await client.query({
        query: "SELECT 1 AS ok",
        format: "JSONEachRow",
      });
      await rs.json();
    };
    const measured = await measureIterations({
      warmup: warmup * 5,
      iterations: latencyRequests,
      allocIterations: Math.min(100, latencyRequests),
      sampler,
      fn: runOne,
    });
    return {
      scenario: "point_latency",
      target: target.id,
      label: target.label,
      stats: measured.stats,
      rate: latencyRequests / (measured.wallMs / 1000),
      rateUnit: "req/s",
      opLabel: "req",
      resources: measured.resources,
    };
  } finally {
    await client.close();
  }
}

async function runConcurrentQueries(
  target: TargetFactory,
  sampler: AllocationSampler,
): Promise<ScenarioMetrics> {
  const client = target.createPlain();
  const waveSize = concurrency * concurrentPerWorker;
  const waves = Math.max(3, Math.ceil(iterations / 2));
  try {
    const runOne = async (n: number) => {
      const rs = await client.query({
        query: `SELECT ${n} AS id, 'payload_${n % 64}' AS label`,
        format: "JSONEachRow",
      });
      await rs.json();
    };
    const runWave = async () => {
      await Promise.all(
        Array.from({ length: concurrency }, async (_, worker) => {
          for (let i = 0; i < concurrentPerWorker; i++) {
            await runOne(worker * concurrentPerWorker + i);
          }
        }),
      );
    };
    const measured = await measureIterations({
      warmup,
      iterations: waves,
      opsPerIteration: waveSize,
      allocIterations: 1,
      sampler,
      fn: runWave,
    });
    return {
      scenario: "concurrent_queries",
      target: target.id,
      label: target.label,
      stats: measured.stats,
      rate: (waves * waveSize) / (measured.wallMs / 1000),
      rateUnit: "req/s",
      opLabel: "req",
      resources: measured.resources,
    };
  } finally {
    await client.close();
  }
}

async function runSelectJsonObjects(
  target: TargetFactory,
  sampler: AllocationSampler,
): Promise<ScenarioMetrics> {
  const client = target.createPlain();
  const query = `
    SELECT
      number AS id,
      toInt32(number % 100000 - 50000) AS delta,
      toFloat64(number % 1000) * 0.125 AS score,
      concat('user_', toString(number % 10000)) AS name,
      toDateTime(1700000000 + (number % 86400), 'UTC') AS ts
    FROM system.numbers
    LIMIT ${selectJsonRows}
  `;
  try {
    const measured = await measureIterations({
      warmup,
      iterations,
      sampler,
      fn: async () => {
        const rs = await client.query({ query, format: "JSONEachRow" });
        const rows = await rs.json();
        if (rows.length !== selectJsonRows) {
          throw new Error(
            `Expected ${selectJsonRows} rows, got ${rows.length}`,
          );
        }
      },
    });
    return {
      scenario: "select_json_objects",
      target: target.id,
      label: target.label,
      stats: measured.stats,
      rate: selectJsonRows / (measured.stats.mean / 1000),
      rateUnit: "rows/s",
      opLabel: "100k",
      resources: measured.resources,
    };
  } finally {
    await client.close();
  }
}

async function runSelectStreamRows(
  target: TargetFactory,
  sampler: AllocationSampler,
): Promise<ScenarioMetrics> {
  const client = target.createPlain();
  const query = `
    SELECT
      number AS id,
      toUInt32(number % 65536) AS grp,
      concat('row_', toString(number % 1000)) AS tag
    FROM system.numbers
    LIMIT ${selectStreamRows}
  `;
  try {
    const measured = await measureIterations({
      warmup,
      iterations,
      sampler,
      fn: async () => {
        const rs = await client.query({ query, format: "JSONEachRow" });
        let count = 0;
        for await (const rows of rs.stream()) {
          count += rows.length;
        }
        if (count !== selectStreamRows) {
          throw new Error(`Expected ${selectStreamRows} rows, got ${count}`);
        }
      },
    });
    return {
      scenario: "select_stream_rows",
      target: target.id,
      label: target.label,
      stats: measured.stats,
      rate: selectStreamRows / (measured.stats.mean / 1000),
      rateUnit: "rows/s",
      opLabel: "200k",
      resources: measured.resources,
    };
  } finally {
    await client.close();
  }
}

async function runSelectCompressed(
  target: TargetFactory,
  sampler: AllocationSampler,
): Promise<ScenarioMetrics> {
  const client = target.createCompressed();
  const query = `
    SELECT
      number AS id,
      toInt64(number * 3) AS metric,
      concat('service-', toString(number % 200), '-region-', toString(number % 10)) AS label
    FROM system.numbers
    LIMIT ${compressedRows}
  `;
  try {
    const measured = await measureIterations({
      warmup,
      iterations,
      sampler,
      fn: async () => {
        const rs = await client.query({ query, format: "JSONEachRow" });
        const rows = await rs.json();
        if (rows.length !== compressedRows) {
          throw new Error(
            `Expected ${compressedRows} rows, got ${rows.length}`,
          );
        }
      },
    });
    return {
      scenario: "select_compressed",
      target: target.id,
      label: target.label,
      stats: measured.stats,
      rate: compressedRows / (measured.stats.mean / 1000),
      rateUnit: "rows/s",
      opLabel: "200k",
      resources: measured.resources,
    };
  } finally {
    await client.close();
  }
}

async function runInsertJsonRows(
  target: TargetFactory,
  precomputedRows: ReturnType<typeof buildJsonInsertRows>,
  sampler: AllocationSampler,
): Promise<ScenarioMetrics> {
  const client = target.createCompressed();
  const table =
    "FUNCTION null('id UInt64, grp UInt32, score Float64, tag String, ts DateTime')";
  try {
    const measured = await measureIterations({
      warmup,
      iterations,
      sampler,
      fn: async () => {
        await client.insert({
          table,
          format: "JSONEachRow",
          values: precomputedRows,
        });
      },
    });
    return {
      scenario: "insert_json_rows",
      target: target.id,
      label: target.label,
      stats: measured.stats,
      rate: precomputedRows.length / (measured.stats.mean / 1000),
      rateUnit: "rows/s",
      opLabel: "100k",
      resources: measured.resources,
    };
  } finally {
    await client.close();
  }
}

async function runInsertRawCsvStream(
  target: TargetFactory,
  csv: { chunks: Buffer[]; totalBytes: number },
  sampler: AllocationSampler,
): Promise<ScenarioMetrics> {
  const client = target.createPlain();
  const table =
    "FUNCTION null('id UInt64, grp UInt32, tag String, score Float64')";
  try {
    const measured = await measureIterations({
      warmup,
      iterations,
      sampler,
      fn: async () => {
        await client.insert({
          table,
          format: "CSV",
          values: Readable.from(csv.chunks, { objectMode: false }),
        });
      },
    });
    const totalMiB = csv.totalBytes / (1024 * 1024);
    return {
      scenario: "insert_raw_csv_stream",
      target: target.id,
      label: target.label,
      stats: measured.stats,
      rate: totalMiB / (measured.stats.mean / 1000),
      rateUnit: "MiB/s",
      opLabel: "1M",
      resources: measured.resources,
    };
  } finally {
    await client.close();
  }
}

async function runSelectComplexTypes(
  target: TargetFactory,
  sampler: AllocationSampler,
): Promise<ScenarioMetrics> {
  const client = target.createPlain();
  const query = `
    SELECT
      number AS id,
      tuple(toInt32(number % 1000), concat('k', toString(number % 100)), toFloat64(number % 50) * 0.5) AS tup,
      [toInt32(number % 10), toInt32((number + 1) % 10), toInt32((number + 2) % 10)] AS arr,
      toDateTime(1577836800 + (number % 3000) * 86400 + (number % 3600), 'Europe/Berlin') AS ts_berlin,
      concat('{"z":', toString(number % 100), ',"a":"v', toString(number % 50), '","m":{"b":', toString(number % 10), '}}')::JSON AS doc
    FROM system.numbers
    LIMIT ${complexRows}
  `;
  try {
    const measured = await measureIterations({
      warmup,
      iterations,
      sampler,
      fn: async () => {
        const rs = await client.query({
          query,
          format: "JSONEachRow",
          clickhouse_settings: { allow_experimental_json_type: 1 },
        });
        const rows = await rs.json();
        if (rows.length !== complexRows) {
          throw new Error(`Expected ${complexRows} rows, got ${rows.length}`);
        }
      },
    });
    return {
      scenario: "select_complex_types",
      target: target.id,
      label: target.label,
      stats: measured.stats,
      rate: complexRows / (measured.stats.mean / 1000),
      rateUnit: "rows/s",
      opLabel: "50k",
      resources: measured.resources,
    };
  } finally {
    await client.close();
  }
}

async function runSelectJsonPaths(
  target: TargetFactory,
  sampler: AllocationSampler,
): Promise<ScenarioMetrics> {
  const client = target.createPlain();
  const query = `
    SELECT
      concat(
        '{"z":', toString(number % 100),
        ',"m":"v', toString(number % 50),
        '","a":', toString(number % 10),
        ',"f":', toString(number % 20),
        ',"c":"s', toString(number % 30),
        '","k":', toString(number % 40),
        ',"b":', toString(number % 5),
        ',"d":', toString(number % 7),
        '}'
      )::JSON AS doc
    FROM system.numbers
    LIMIT ${jsonPathsRows}
  `;
  try {
    const measured = await measureIterations({
      warmup,
      iterations,
      sampler,
      fn: async () => {
        const rs = await client.query({
          query,
          format: "JSONEachRow",
          clickhouse_settings: {
            allow_experimental_json_type: 1,
            output_format_native_write_json_as_string: 0,
            output_format_native_use_flattened_dynamic_and_json_serialization: 0,
          },
        });
        const rows = await rs.json();
        if (rows.length !== jsonPathsRows) {
          throw new Error(`Expected ${jsonPathsRows} rows, got ${rows.length}`);
        }
      },
    });
    return {
      scenario: "select_json_paths",
      target: target.id,
      label: target.label,
      stats: measured.stats,
      rate: jsonPathsRows / (measured.stats.mean / 1000),
      rateUnit: "rows/s",
      opLabel: "50k",
      resources: measured.resources,
    };
  } finally {
    await client.close();
  }
}

async function runCancelHeavyQuery(
  target: TargetFactory,
  sampler: AllocationSampler,
): Promise<ScenarioMetrics> {
  const client = target.createPlain();
  try {
    const measured = await measureIterations({
      warmup,
      iterations,
      sampler,
      fn: async () => {
        const rs = await client.query({
          query:
            "SELECT number, toString(number) AS s FROM system.numbers LIMIT 50000000",
          format: "JSONEachRow",
        });
        const stream = rs.stream();
        for await (const batch of stream) {
          if (batch.length > 0) {
            rs.close();
            break;
          }
        }
        const pingRs = await client.query({
          query: "SELECT 1 AS ok",
          format: "JSONEachRow",
        });
        await pingRs.json();
      },
    });
    return {
      scenario: "cancel_heavy_query",
      target: target.id,
      label: target.label,
      stats: measured.stats,
      rate: 1000 / measured.stats.mean,
      rateUnit: "req/s",
      opLabel: "cancel",
      resources: measured.resources,
    };
  } finally {
    await client.close();
  }
}

function formatRate(rate: number, unit: ScenarioMetrics["rateUnit"]): string {
  if (unit === "MiB/s") return mibs(rate);
  if (rate >= 1_000_000) return `${(rate / 1_000_000).toFixed(2)}M ${unit}`;
  if (rate >= 1_000) return `${(rate / 1_000).toFixed(1)}k ${unit}`;
  return `${rate.toFixed(1)} ${unit}`;
}

function formatSpeedup(afterRate: number, baseRate: number): string {
  if (baseRate <= 0) return "n/a";
  const ratio = afterRate / baseRate;
  const pct = (ratio - 1) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${ratio.toFixed(2)}x (${sign}${pct.toFixed(1)}%)`;
}

async function run(): Promise<void> {
  attachExceptionHandlers();

  const targets: TargetFactory[] = [
    {
      id: "http",
      label: "@clickhouse/client (http)",
      createPlain: () =>
        createHttpClient({
          url: httpUrl,
          max_open_connections: Math.max(16, concurrency),
          compression: { request: false, response: false },
        }),
      createCompressed: () =>
        createHttpClient({
          url: httpUrl,
          max_open_connections: Math.max(16, concurrency),
          compression: { request: true, response: true },
        }),
    },
  ];

  if (beforeModulePath) {
    const createBeforeNative = await loadBeforeCreateClient(beforeModulePath);
    targets.push({
      id: "native-before",
      label: "@clickhouse/client-native (before)",
      createPlain: () =>
        createBeforeNative({
          url: nativeUrl,
          max_open_connections: Math.max(16, concurrency),
          compression: "none",
        }),
      createCompressed: () =>
        createBeforeNative({
          url: nativeUrl,
          max_open_connections: Math.max(16, concurrency),
          compression: "lz4",
        }),
    });
  }

  targets.push({
    id: "native-after",
    label: "@clickhouse/client-native (after)",
    createPlain: () =>
      createNativeClient({
        url: nativeUrl,
        max_open_connections: Math.max(16, concurrency),
        compression: "none",
      }),
    createCompressed: () =>
      createNativeClient({
        url: nativeUrl,
        max_open_connections: Math.max(16, concurrency),
        compression: "lz4",
      }),
  });

  console.log("ClickHouse Native TCP vs HTTP Performance & Resource Suite");
  console.log("Configuration:");
  console.log(`  httpUrl:          ${httpUrl}`);
  console.log(`  nativeUrl:        ${nativeUrl}`);
  console.log(`  beforeModule:     ${beforeModulePath ?? "(none)"}`);
  console.log(`  node:             ${process.version}`);
  console.log(
    `  expose-gc:        ${typeof (globalThis as { gc?: unknown }).gc === "function"}`,
  );
  console.log(`  iterations:       ${iterations} (warmup=${warmup})`);
  console.log();

  const precomputedJsonRows = buildJsonInsertRows(insertJsonRows);
  const precomputedCsv = buildCsvChunks(insertCsvRows);
  const sampler = new AllocationSampler();

  const scenarios: Array<{
    name: string;
    description: string;
    run: (target: TargetFactory) => Promise<ScenarioMetrics>;
  }> = [
    {
      name: "point_latency",
      description: `Sequential SELECT 1 (${latencyRequests} reqs)`,
      run: (t) => runPointLatency(t, sampler),
    },
    {
      name: "concurrent_queries",
      description: `Concurrent pool (${concurrency}x${concurrentPerWorker} reqs)`,
      run: (t) => runConcurrentQueries(t, sampler),
    },
    {
      name: "select_json_objects",
      description: `JSONEachRow .json() (${selectJsonRows.toLocaleString()} rows, mixed types)`,
      run: (t) => runSelectJsonObjects(t, sampler),
    },
    {
      name: "select_stream_rows",
      description: `JSONEachRow .stream() (${selectStreamRows.toLocaleString()} rows, binary fast path)`,
      run: (t) => runSelectStreamRows(t, sampler),
    },
    {
      name: "select_compressed",
      description: `Compressed .json() (${compressedRows.toLocaleString()} rows, LZ4 vs gzip)`,
      run: (t) => runSelectCompressed(t, sampler),
    },
    {
      name: "insert_json_rows",
      description: `Structured JSONEachRow insert (${insertJsonRows.toLocaleString()} rows, LZ4 vs gzip)`,
      run: (t) => runInsertJsonRows(t, precomputedJsonRows, sampler),
    },
    {
      name: "insert_raw_csv_stream",
      description: `Raw multi-chunk CSV stream insert (${insertCsvRows.toLocaleString()} rows, ${(precomputedCsv.totalBytes / (1024 * 1024)).toFixed(1)} MiB)`,
      run: (t) => runInsertRawCsvStream(t, precomputedCsv, sampler),
    },
    {
      name: "select_complex_types",
      description: `Complex types: Tuple/Array/JSON/TZ (${complexRows.toLocaleString()} rows)`,
      run: (t) => runSelectComplexTypes(t, sampler),
    },
    {
      name: "select_json_paths",
      description: `JSON binary paths (${jsonPathsRows.toLocaleString()} rows, 8 keys/row, path sorting)`,
      run: (t) => runSelectJsonPaths(t, sampler),
    },
    {
      name: "cancel_heavy_query",
      description: "Early ResultSet.close() on 50M-row query + recovery",
      run: (t) => runCancelHeavyQuery(t, sampler),
    },
  ];

  const allResults: ScenarioMetrics[] = [];

  try {
    for (const scenario of scenarios) {
      if (scenarioFilter !== undefined && !scenarioFilter.has(scenario.name)) {
        continue;
      }
      console.log(`=== ${scenario.name}: ${scenario.description} ===`);
      const byTarget = new Map<TargetFactory["id"], ScenarioMetrics>();
      for (const target of targets) {
        maybeGC();
        const result = await scenario.run(target);
        allResults.push(result);
        byTarget.set(target.id, result);
        const r = result.resources;
        console.log(
          `  ${target.label.padEnd(36)} ` +
            `${formatRate(result.rate, result.rateUnit).padStart(15)}  ` +
            `mean=${ms(result.stats.mean).padStart(9)}  ` +
            `p99=${ms(result.stats.p99).padStart(9)}  ` +
            `cpu=${formatCpuMs(r.cpuMsPerOp).padStart(9)}/${result.opLabel}  ` +
            `alloc=${formatBytes(r.allocBytesPerOp).padStart(10)}  ` +
            `heap=+${formatMiB(r.peakHeapMiB).padStart(9)}  ` +
            `buf=+${formatMiB(r.peakBufMiB).padStart(9)}  ` +
            `gc=${String(r.gcCount).padStart(2)} (${ms(r.gcMs)})`,
        );
      }
      const after = byTarget.get("native-after");
      const before = byTarget.get("native-before");
      const http = byTarget.get("http");
      if (after && before) {
        console.log(
          `  -> after vs before: rate=${formatSpeedup(after.rate, before.rate)}  ` +
            `cpu=${formatReduction(after.resources.cpuMsPerOp, before.resources.cpuMsPerOp)}  ` +
            `alloc=${formatReduction(after.resources.allocBytesPerOp, before.resources.allocBytesPerOp)}`,
        );
      }
      if (after && http) {
        console.log(
          `  -> after vs http:   rate=${formatSpeedup(after.rate, http.rate)}  ` +
            `cpu=${formatReduction(after.resources.cpuMsPerOp, http.resources.cpuMsPerOp)}  ` +
            `alloc=${formatReduction(after.resources.allocBytesPerOp, http.resources.allocBytesPerOp)}`,
        );
      }
      console.log();
    }

    console.log("=== Summary: Throughput ===");
    const rateHeader =
      "Scenario".padEnd(23) +
      "HTTP".padStart(15) +
      (beforeModulePath ? "Native(before)".padStart(16) : "") +
      "Native(after)".padStart(16) +
      (beforeModulePath ? "After vs Before".padStart(18) : "") +
      "After vs HTTP".padStart(18);
    console.log(rateHeader);
    console.log("-".repeat(rateHeader.length));
    for (const scenario of scenarios) {
      if (scenarioFilter !== undefined && !scenarioFilter.has(scenario.name)) {
        continue;
      }
      const http = allResults.find(
        (r) => r.scenario === scenario.name && r.target === "http",
      );
      const before = allResults.find(
        (r) => r.scenario === scenario.name && r.target === "native-before",
      );
      const after = allResults.find(
        (r) => r.scenario === scenario.name && r.target === "native-after",
      );
      if (!http || !after) continue;
      console.log(
        scenario.name.padEnd(23) +
          formatRate(http.rate, http.rateUnit).padStart(15) +
          (before
            ? formatRate(before.rate, before.rateUnit).padStart(16)
            : "") +
          formatRate(after.rate, after.rateUnit).padStart(16) +
          (before ? formatSpeedup(after.rate, before.rate).padStart(18) : "") +
          formatSpeedup(after.rate, http.rate).padStart(18),
      );
    }

    console.log();
    console.log(
      "=== Summary: Node.js CPU, JS Allocations & Peak Memory (per op; lower is better) ===",
    );
    const resHeader =
      "Scenario".padEnd(23) +
      "Target".padEnd(15) +
      "CPU/op".padStart(11) +
      "CPU%".padStart(7) +
      "JS Alloc/op".padStart(13) +
      "Peak Heap".padStart(12) +
      "Peak Buf".padStart(12) +
      "GC (cnt/ms)".padStart(14);
    console.log(resHeader);
    console.log("-".repeat(resHeader.length));
    for (const scenario of scenarios) {
      if (scenarioFilter !== undefined && !scenarioFilter.has(scenario.name)) {
        continue;
      }
      for (const target of targets) {
        const res = allResults.find(
          (r) => r.scenario === scenario.name && r.target === target.id,
        );
        if (!res) continue;
        const m = res.resources;
        const shortTarget =
          target.id === "http"
            ? "http"
            : target.id === "native-before"
              ? "native-before"
              : "native-after";
        console.log(
          scenario.name.padEnd(23) +
            shortTarget.padEnd(15) +
            formatCpuMs(m.cpuMsPerOp).padStart(11) +
            `${m.cpuPercent.toFixed(0)}%`.padStart(7) +
            formatBytes(m.allocBytesPerOp).padStart(13) +
            `+${formatMiB(m.peakHeapMiB)}`.padStart(12) +
            `+${formatMiB(m.peakBufMiB)}`.padStart(12) +
            `${m.gcCount}/${m.gcMs.toFixed(1)}ms`.padStart(14),
        );
      }
    }
  } finally {
    sampler.close();
  }
}

void run().then(() => process.exit(0));
