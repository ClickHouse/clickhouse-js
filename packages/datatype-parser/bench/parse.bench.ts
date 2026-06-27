/**
 * Vitest benchmark for {@link parseDataType}: how fast does the parser turn a
 * ClickHouse type STRING into an AST?
 *
 * This is the cost a `RowBinaryWithNamesAndTypes` consumer pays ONCE per column
 * when it compiles a reader from the header — so the numbers are "per
 * column-type", not per row. Vitest/tinybench handles warmup, sampling, and the
 * hz / mean / p99 reporting; each case below is one representative column shape,
 * simplest → most involved.
 *
 * Run with `npm run bench` (`vitest bench --run`).
 */

import { bench, describe } from "vitest";

import { parseDataType, toJSON } from "../src/index.ts";

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

describe("parseDataType — string → AST", () => {
  for (const { label, type, typical } of CASES) {
    // Guard inside the timed fn doubles as a correctness check and keeps the
    // optimizer from eliding the parse (the result is observed).
    bench(typical ? `${label} (typical)` : label, () => {
      if (!parseDataType(type).ok()) throw new Error(`failed to parse ${type}`);
    });
  }
});

describe("round-trip — parse + toJSON", () => {
  // The full string → AST → JSON path. A header compiler does NOT do this (it
  // folds the AST straight into readers), but it shows what toJSON adds.
  const typical = CASES.find((c) => c.typical)!;
  bench(typical.type, () => {
    const r = parseDataType(typical.type);
    if (r.ast) toJSON(r.ast, -1);
  });
});
