import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { Cursor, Sink } from "../src/core.js";
import {
  readNullable,
  readArray,
  readTuple,
  readTupleNamed,
  readMap,
  readVariant,
  type VariantValue,
} from "../src/composite.js";
import {
  writeNullable,
  writeArray,
  writeTuple,
  writeTupleNamed,
  writeMap,
  writeVariant,
} from "../src/composite.js";
import { readUInt8, readInt32, readUInt32 } from "../src/integers.js";
import { writeUInt8, writeInt32, writeUInt32 } from "../src/integers.js";
import { readString } from "../src/strings.js";
import { writeString } from "../src/strings.js";

function rt<T>(
  bytes: Buffer,
  read: (c: Cursor) => T,
  write: (s: Sink, v: T) => void,
): Buffer {
  const value = read(new Cursor(bytes));
  const sink = new Sink();
  write(sink, value);
  return Buffer.from(sink.bytes());
}

describe("writeNullable", () => {
  it("round-trips a present value", async () => {
    const bytes = await query("SELECT toNullable(toUInt32(42)) FORMAT RowBinary");
    expect(rt(bytes, readNullable(readUInt32), writeNullable(writeUInt32))).toEqual(bytes);
  });
  it("round-trips NULL", async () => {
    const bytes = await query("SELECT CAST(NULL AS Nullable(UInt32)) FORMAT RowBinary");
    expect(rt(bytes, readNullable(readUInt32), writeNullable(writeUInt32))).toEqual(bytes);
  });
});

describe("writeArray", () => {
  it("round-trips Array(UInt32)", async () => {
    const bytes = await query("SELECT [1, 2, 3]::Array(UInt32) FORMAT RowBinary");
    expect(rt(bytes, readArray(readUInt32), writeArray(writeUInt32))).toEqual(bytes);
  });
  it("round-trips an empty array", async () => {
    const bytes = await query("SELECT []::Array(UInt32) FORMAT RowBinary");
    expect(rt(bytes, readArray(readUInt32), writeArray(writeUInt32))).toEqual(bytes);
  });
});

describe("writeTuple / writeTupleNamed", () => {
  it("round-trips Tuple(UInt32, String)", async () => {
    const bytes = await query("SELECT (toUInt32(7), 'hi') FORMAT RowBinary");
    const read = readTuple<[number, string]>([readUInt32, readString]);
    const write = writeTuple<[number, string]>([writeUInt32, writeString]);
    expect(rt(bytes, read, write)).toEqual(bytes);
  });
  it("round-trips a named Tuple", async () => {
    const bytes = await query(
      "SELECT CAST((toUInt32(7), 'hi'), 'Tuple(id UInt32, name String)') FORMAT RowBinary",
    );
    const read = readTupleNamed<{ id: number; name: string }>({ id: readUInt32, name: readString });
    const write = writeTupleNamed<{ id: number; name: string }>({ id: writeUInt32, name: writeString });
    expect(rt(bytes, read, write)).toEqual(bytes);
  });
});

describe("writeMap", () => {
  it("round-trips Map(String, UInt32)", async () => {
    const bytes = await query(
      "SELECT map('a', toUInt32(1), 'b', toUInt32(2)) FORMAT RowBinary",
    );
    expect(
      rt(bytes, readMap(readString, readUInt32), writeMap(writeString, writeUInt32)),
    ).toEqual(bytes);
  });
});

describe("writeVariant", () => {
  // Variant(Int32, String) sorts by type name: ["Int32", "String"].
  const readers = [readInt32, readString];
  const writers = [writeInt32, writeString];

  async function variantBytes(expr: string): Promise<Buffer> {
    return query(
      `SELECT CAST(${expr}, 'Variant(Int32, String)') SETTINGS allow_experimental_variant_type = 1 FORMAT RowBinary`,
    );
  }

  it("round-trips each alternative and NULL (with explicit discriminant)", async () => {
    for (const [expr, disc] of [
      ["toInt32(-5)", 0],
      ["'hello'", 1],
    ] as const) {
      const bytes = await variantBytes(expr);
      // Decode the discriminant + value from the wire, then re-encode tagged.
      const c = new Cursor(bytes);
      const d = readUInt8(c);
      const value = readers[d]!(c);
      const tagged: VariantValue = [d, value];
      expect(d).toBe(disc);
      const sink = new Sink();
      writeVariant(writers)(sink, tagged);
      expect(Buffer.from(sink.bytes())).toEqual(bytes);
    }
  });

  it("writes NULL as a single 0xFF byte", () => {
    const sink = new Sink();
    writeVariant(writers)(sink, null);
    expect([...sink.bytes()]).toEqual([0xff]);
  });

  it("readVariant reads back what writeVariant wrote", () => {
    const sink = new Sink();
    writeVariant(writers)(sink, [1, "x"]);
    expect(readVariant(readers)(new Cursor(Buffer.from(sink.bytes())))).toBe("x");
  });
});
