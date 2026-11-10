import { describe, expect, it } from "vitest";
import { parseDataType } from "@clickhouse/datatype-parser";
import { query } from "./clickhouse.js";
import { Cursor } from "../src/readers/core.js";
import { astToReader, RowBinaryTypeError } from "../src/readers/compile.js";

// compile.ts is AST in, reader out. These tests exercise that fold directly:
// parse a type string, fold it to a Reader, and decode plain RowBinary value
// bytes (no header) from the server. The end-to-end header/stream path is
// covered in rowBinaryWithNamesAndTypes.test.ts.

/** Parse a type string and fold its AST into a reader. */
function reader(type: string) {
  const result = parseDataType(type);
  if (!result.ok()) throw new Error(`parse failed: ${result.error!.message}`);
  return astToReader(result.ast!);
}

/** Fold `type` to a reader and decode one `expr` value (`FORMAT RowBinary`). */
async function fold(type: string, expr: string): Promise<unknown> {
  const read = reader(type);
  const s = new Cursor(await query(`SELECT ${expr} FORMAT RowBinary`));
  const out = read(s);
  expect(s.pos).toBe(s.buf.length); // the fold framed the bytes exactly
  return out;
}

describe("astToReader (AST -> Reader fold)", () => {
  it("folds a scalar type", async () => {
    expect(await fold("UInt32", "toUInt32(7)")).toEqual(7);
  });

  it("folds Nullable into a null-flag reader", async () => {
    expect(
      await fold("Nullable(UInt64)", "CAST(NULL AS Nullable(UInt64))"),
    ).toEqual(null);
  });

  it("folds a nested composite (Array of Nullable)", async () => {
    expect(
      await fold(
        "Array(Nullable(UInt32))",
        "CAST([1, NULL, 3] AS Array(Nullable(UInt32)))",
      ),
    ).toEqual([1, null, 3]);
  });

  it("folds Map by recursing into key and value readers", async () => {
    expect(
      await fold(
        "Map(String, UInt8)",
        "CAST(map('a', 1) AS Map(String, UInt8))",
      ),
    ).toEqual(new Map([["a", 1]]));
  });

  it("folds an unnamed Tuple to a positional array", async () => {
    expect(
      await fold(
        "Tuple(UInt8, String)",
        "CAST((7, 'x') AS Tuple(UInt8, String))",
      ),
    ).toEqual([7, "x"]);
  });

  it("folds a named Tuple to an object", async () => {
    expect(
      await fold(
        "Tuple(a UInt8, b String)",
        "CAST((7, 'x') AS Tuple(a UInt8, b String))",
      ),
    ).toEqual({ a: 7, b: "x" });
  });

  it("picks the Decimal width by precision (P=20 -> Decimal128)", async () => {
    expect(await fold("Decimal(20, 4)", "CAST(1.5 AS Decimal(20, 4))")).toEqual(
      [15000n, 4],
    );
  });

  it("folds Nested into Array(Tuple) of objects", async () => {
    expect(
      await fold(
        "Nested(a UInt8, b String)",
        "CAST([(1, 'a'), (2, 'b')] AS Nested(a UInt8, b String))",
      ),
    ).toEqual([
      { a: 1, b: "a" },
      { a: 2, b: "b" },
    ]);
  });

  it("folds Variant in sorted-by-name (discriminant) order", async () => {
    // The wire discriminant indexes alternatives sorted by type name, so the
    // reader must be folded from that sorted order — here Variant(String, UInt8).
    // The server normalizes the column type to the same sorted form.
    expect(
      await fold(
        "Variant(String, UInt8)",
        "CAST(42 AS Variant(UInt8, String)) SETTINGS allow_experimental_variant_type=1",
      ),
    ).toEqual(42);
  });

  describe("bare Enum(...) width", () => {
    // A bare `Enum` names no width: the server sizes it from the ordinals
    // (Enum16 if any value is outside -128..127), so the fold must as well.
    it("folds a bare Enum with a large ordinal as Enum16", async () => {
      expect(
        await fold("Enum('a' = 1000)", `CAST(1000, 'Enum(\\'a\\' = 1000)')`),
      ).toEqual("a");
    });

    it("folds a bare Enum with ordinal 128 as Enum16", async () => {
      expect(
        await fold("Enum('a' = 128)", `CAST(128, 'Enum(\\'a\\' = 128)')`),
      ).toEqual("a");
    });

    it("folds a bare Enum with a negative ordinal below Int8 as Enum16", async () => {
      expect(
        await fold("Enum('a' = -129)", `CAST(-129, 'Enum(\\'a\\' = -129)')`),
      ).toEqual("a");
    });

    it("folds a bare Enum with small ordinals as Enum8", async () => {
      expect(
        await fold("Enum('a' = 1)", `CAST(1, 'Enum(\\'a\\' = 1)')`),
      ).toEqual("a");
    });

    it("does not desync the following column", async () => {
      const read = reader("Enum('a' = 1000)");
      const readU8 = reader("UInt8");
      const s = new Cursor(
        await query(
          `SELECT CAST(1000, 'Enum(\\'a\\' = 1000)'), toUInt8(7) FORMAT RowBinary`,
        ),
      );
      expect([read(s), readU8(s)]).toEqual(["a", 7]);
      expect(s.pos).toBe(s.buf.length);
    });
  });

  it("throws a typed RowBinaryTypeError for a non-type AST node (a Literal argument)", () => {
    // FixedString(16)'s argument is a Literal — not a standalone column type.
    const ast = parseDataType("FixedString(16)");
    const literalArg = ast.ast!.arguments[0]!;
    expect(() => astToReader(literalArg)).toThrow(RowBinaryTypeError);
    expect(() => astToReader(literalArg)).toThrow(
      /cannot build a column reader/,
    );
  });
});
