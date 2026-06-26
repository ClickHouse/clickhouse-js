import { describe, expect, it } from "vitest";
import { Cursor } from "../src/core.js";
import {
  compileRowBinaryWithNamesAndTypes,
  readHeader,
  typeStringToReader,
} from "../src/compile.js";

/**
 * A tiny RowBinaryWithNamesAndTypes ENCODER, just enough to drive the compiler
 * offline (the rest of the suite reads bytes from a live server). It mirrors the
 * wire the server would produce so these tests need no ClickHouse.
 */
class Writer {
  private readonly parts: Buffer[] = [];

  uvarint(n: number): this {
    const out: number[] = [];
    let v = n;
    do {
      let b = v & 0x7f;
      v >>>= 7;
      if (v !== 0) b |= 0x80;
      out.push(b);
    } while (v !== 0);
    this.parts.push(Buffer.from(out));
    return this;
  }

  string(s: string): this {
    const b = Buffer.from(s, "utf8");
    return this.uvarint(b.length).raw(b);
  }

  u8(n: number): this {
    return this.raw(Buffer.from([n & 0xff]));
  }

  u32(n: number): this {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n >>> 0);
    return this.raw(b);
  }

  raw(b: Buffer): this {
    this.parts.push(b);
    return this;
  }

  done(): Buffer {
    return Buffer.concat(this.parts);
  }
}

/** Encode just the WithNamesAndTypes header (count, names, types). */
function header(w: Writer, names: string[], types: string[]): Writer {
  w.uvarint(names.length);
  for (const n of names) w.string(n);
  for (const t of types) w.string(t);
  return w;
}

describe("readHeader", () => {
  it("reads column count, names, then types and stops at the first row", () => {
    const w = header(new Writer(), ["id", "name"], ["UInt32", "String"]);
    w.u32(7).string("x"); // one row, so we can check the cursor lands on it
    const s = new Cursor(w.done());

    expect(readHeader(s)).toEqual({
      names: ["id", "name"],
      types: ["UInt32", "String"],
    });
    // Cursor now points at the row payload.
    expect(s.buf.readUInt32LE(s.pos)).toBe(7);
  });
});

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
