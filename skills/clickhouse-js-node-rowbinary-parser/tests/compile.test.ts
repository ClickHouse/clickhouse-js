import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { Cursor } from "../src/core.js";
import {
  compileRowBinaryWithNamesAndTypes,
  typeStringToReader,
} from "../src/compile.js";

/** Raw value bytes for one expression (`FORMAT RowBinary`, no header). */
async function rowBinary(expr: string): Promise<Cursor> {
  return new Cursor(await query(`SELECT ${expr} FORMAT RowBinary`));
}

/** A full `RowBinaryWithNamesAndTypes` response (header + rows) as a cursor. */
async function withNamesAndTypes(select: string): Promise<Cursor> {
  return new Cursor(await query(`${select} FORMAT RowBinaryWithNamesAndTypes`));
}

describe("typeStringToReader (AST -> combinator fold)", () => {
  it("folds a nested composite type into a working reader", async () => {
    const s = await rowBinary("CAST([1, NULL, 3] AS Array(Nullable(UInt32)))");
    expect(typeStringToReader("Array(Nullable(UInt32))")(s)).toEqual([
      1,
      null,
      3,
    ]);
  });

  it("surfaces a clear error for an unsupported type", () => {
    expect(() => typeStringToReader("AggregateFunction(sum, UInt64)")).toThrow(
      /cannot compile type/,
    );
  });
});

describe("compileRowBinaryWithNamesAndTypes", () => {
  it("compiles a header and decodes the rest of the stream into rows", async () => {
    const s = await withNamesAndTypes(`
      SELECT id, name, score FROM (
        SELECT toUInt32(1) AS id, CAST('alice' AS Nullable(String)) AS name, toFloat64(1.5) AS score
        UNION ALL
        SELECT toUInt32(2) AS id, CAST(NULL AS Nullable(String)) AS name, toFloat64(2.5) AS score
      ) ORDER BY id
    `);

    const compiled = compileRowBinaryWithNamesAndTypes(s);
    expect(compiled.names).toEqual(["id", "name", "score"]);
    expect(compiled.types).toEqual(["UInt32", "Nullable(String)", "Float64"]);

    const rows = compiled.readRows(s);
    expect(rows).toEqual([
      { id: 1, name: "alice", score: 1.5 },
      { id: 2, name: null, score: 2.5 },
    ]);
    expect(s.pos).toBe(s.buf.length); // consumed exactly
  });

  it("handles a named Tuple and a Map column", async () => {
    const s = await withNamesAndTypes(`
      SELECT
        CAST((10, 20) AS Tuple(a UInt32, b UInt32)) AS pair,
        CAST(map('x', toUInt32(1), 'y', toUInt32(2)) AS Map(String, UInt32)) AS counts
    `);

    const compiled = compileRowBinaryWithNamesAndTypes(s);
    const rows = compiled.readRows(s);

    expect(rows).toHaveLength(1);
    // A named Tuple folds to readTupleNamed -> an object keyed by field name.
    expect(rows[0]!.pair).toEqual({ a: 10, b: 20 });
    expect(rows[0]!.counts).toEqual(
      new Map([
        ["x", 1],
        ["y", 2],
      ]),
    );
  });
});
