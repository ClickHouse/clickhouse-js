import { describe, expect, it } from "vitest";
import { Cursor } from "../src/core.js";
import {
  compileRowBinaryWithNamesAndTypes,
  typeStringToReader,
} from "../src/compile.js";
import { Writer, header } from "./rowBinaryWriter.js";

describe("typeStringToReader (AST -> combinator fold)", () => {
  it("folds a nested composite type into a working reader", () => {
    // Array(Nullable(UInt32)) with values [1, NULL, 3].
    const w = new Writer()
      .uvarint(3) // array length
      .u8(0)
      .u32(1) // present, 1
      .u8(1) // NULL
      .u8(0)
      .u32(3); // present, 3
    const s = new Cursor(w.done());

    const read = typeStringToReader("Array(Nullable(UInt32))");
    expect(read(s)).toEqual([1, null, 3]);
  });

  it("surfaces a clear error for an unsupported type", () => {
    expect(() => typeStringToReader("AggregateFunction(sum, UInt64)")).toThrow(
      /cannot compile type/,
    );
  });
});

describe("compileRowBinaryWithNamesAndTypes", () => {
  it("compiles a header and decodes the rest of the stream into rows", () => {
    const w = header(
      new Writer(),
      ["id", "name", "score"],
      ["UInt32", "Nullable(String)", "Float64"],
    );
    // row 1: 1, "alice", 1.5
    w.u32(1).u8(0).string("alice");
    const f1 = Buffer.alloc(8);
    f1.writeDoubleLE(1.5);
    w.raw(f1);
    // row 2: 2, NULL, 2.5
    w.u32(2).u8(1);
    const f2 = Buffer.alloc(8);
    f2.writeDoubleLE(2.5);
    w.raw(f2);

    const s = new Cursor(w.done());
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

  it("handles a named Tuple and a Map column", () => {
    const w = header(
      new Writer(),
      ["pair", "counts"],
      ["Tuple(a UInt32, b UInt32)", "Map(String, UInt32)"],
    );
    // row: pair=(10, 20), counts={"x":1,"y":2}
    w.u32(10).u32(20); // tuple: two values back to back
    w.uvarint(2) // map pair count
      .string("x")
      .u32(1)
      .string("y")
      .u32(2);

    const s = new Cursor(w.done());
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
