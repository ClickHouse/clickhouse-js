/**
 * A small, dependency-free micro-benchmark for {@link parseDataType}.
 *
 * It answers one question: how fast does the parser turn a ClickHouse type
 * STRING into an AST? That is the cost a `RowBinaryWithNamesAndTypes` consumer
 * pays ONCE per column when it compiles a reader from the header — so the
 * numbers here are "per column-type", not per row.
 *
 * Methodology (kept honest on purpose):
 *  - Warm up first so we measure JITed steady state, not the interpreter.
 *  - Auto-calibrate the batch size until one batch runs long enough that timer
 *    resolution and loop overhead are noise (>= MIN_BATCH_MS).
 *  - Take several samples and report the MEDIAN ops/sec (robust to a GC pause
 *    or a scheduler hiccup landing in one sample) plus the relative standard
 *    deviation so a noisy run is visible rather than silently misleading.
 *  - Accumulate a `sink` from every result so V8 can't dead-code-eliminate the
 *    work we are trying to time.
 *
 * Run with `npm run bench` (tsx). This is a dev tool, not shipped in `dist`.
 */

import { performance } from "node:perf_hooks";

import { parseDataType, toJSON, type Node } from "../src/index.ts";

/** Representative column types, simplest → most involved. */
const CASES: ReadonlyArray<{ label: string; type: string; typical?: boolean }> =
  [
    { label: "scalar", type: "UInt64" },
    { label: "enum", type: "Enum8('a' = 1, 'b' = 2, 'c' = 3)" },
    { label: "parametric", type: "DateTime64(3, 'UTC')" },
    { label: "low-cardinality", type: "LowCardinality(String)" },
    // A very common real-world column shape, used as the headline "typical" row.
    {
      label: "nullable array",
      type: "Array(LowCardinality(Nullable(String)))",
      typical: true,
    },
    { label: "map", type: "Map(String, Array(UInt64))" },
    {
      label: "wide tuple",
      type: "Tuple(id UInt64, name LowCardinality(String), price Decimal(18, 4), ts DateTime64(9, 'UTC'), tags Array(LowCardinality(Nullable(String))), attrs Map(String, Array(Nullable(Int32))))",
    },
  ];

/** Kept live across the whole run so the optimizer can't elide parsing. */
let sink = 0;

/** Count AST nodes — a cheap way to both touch the result and sanity-check it. */
function countNodes(node: Node | null): number {
  if (node === null) return 0;
  let n = 1;
  for (const child of node.arguments) n += countNodes(child);
  if (node.data_type) n += countNodes(node.data_type);
  return n;
}

interface Sample {
  label: string;
  len: number;
  nsPerOp: number;
  opsPerSec: number;
  rsdPct: number;
}

const MIN_BATCH_MS = 50;
const SAMPLES = 15;
const WARMUP_ITERS = 20_000;

function measure(label: string, len: number, run: () => void): Sample {
  for (let i = 0; i < WARMUP_ITERS; i++) run();

  // Grow the batch until a single batch is comfortably above timer noise.
  let iters = 1024;
  for (;;) {
    const t0 = performance.now();
    for (let i = 0; i < iters; i++) run();
    if (performance.now() - t0 >= MIN_BATCH_MS) break;
    iters *= 2;
  }

  const rates: number[] = [];
  for (let s = 0; s < SAMPLES; s++) {
    const t0 = performance.now();
    for (let i = 0; i < iters; i++) run();
    const ms = performance.now() - t0;
    rates.push((iters / ms) * 1000);
  }

  rates.sort((a, b) => a - b);
  const median = rates[rates.length >> 1]!;
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance =
    rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length;
  const rsdPct = (Math.sqrt(variance) / mean) * 100;

  return { label, len, nsPerOp: 1e9 / median, opsPerSec: median, rsdPct };
}

function fmtOps(opsPerSec: number): string {
  return opsPerSec >= 1e6
    ? `${(opsPerSec / 1e6).toFixed(2)}M/s`
    : `${(opsPerSec / 1e3).toFixed(1)}k/s`;
}

function table(title: string, rows: Sample[]): void {
  console.log(`\n${title}`);
  const head = ["type", "len", "ns/op", "ops/sec", "±rsd"];
  const widths = [22, 4, 8, 9, 6];
  const line = (cols: string[]) =>
    cols.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  console.log(line(head));
  for (const r of rows) {
    console.log(
      line([
        r.label,
        String(r.len),
        r.nsPerOp.toFixed(0),
        fmtOps(r.opsPerSec),
        `${r.rsdPct.toFixed(1)}%`,
      ]),
    );
  }
}

// --- parse only -------------------------------------------------------------
const parseRows = CASES.map(({ label, type, typical }) =>
  measure(typical ? `${label} *` : label, type.length, () => {
    // countNodes walks the whole AST, so the optimizer can't skip building it.
    sink += countNodes(parseDataType(type).ast);
  }),
);
table("parseDataType — string → AST    (* = typical column)", parseRows);

// --- parse + serialize ------------------------------------------------------
// The full round-trip a header compiler does NOT do (it folds the AST directly),
// but useful to see what `toJSON` adds on top of the parse for the typical type.
const typical = CASES.find((c) => c.typical)!;
const roundTrip = measure("parse + toJSON", typical.type.length, () => {
  const r = parseDataType(typical.type);
  if (r.ast) sink += toJSON(r.ast, -1).length;
});
table(`round-trip on the typical type (${typical.type})`, [roundTrip]);

// Touch the sink so the whole computation is observably needed.
if (sink === -1) console.log("unreachable");
console.log(
  `\n(node ${process.version}; median of ${SAMPLES} samples; checksum ${sink})`,
);
