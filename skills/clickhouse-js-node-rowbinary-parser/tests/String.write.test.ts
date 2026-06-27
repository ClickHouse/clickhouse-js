import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { Cursor, Sink } from "../src/core.js";
import { readString, readFixedString, readFixedStringBytes } from "../src/strings.js";
import {
  writeString,
  writeFixedString,
  writeFixedStringBytes,
} from "../src/strings.js";

async function bytesOf(expr: string): Promise<Buffer> {
  return query(`SELECT ${expr} FORMAT RowBinary`);
}

describe("writeString", () => {
  for (const expr of ["''", "'hello'", "'héllo · 日本'", "repeat('x', 300)"]) {
    it(`round-trips ${expr}`, async () => {
      const bytes = await bytesOf(expr);
      const value = readString(new Cursor(bytes));
      const sink = new Sink();
      writeString(sink, value);
      expect(Buffer.from(sink.bytes())).toEqual(bytes);
    });
  }

  it("writes raw (non-UTF-8) bytes from a Uint8Array", () => {
    const raw = Buffer.from([0xff, 0x00, 0xfe]);
    const sink = new Sink();
    writeString(sink, raw);
    // varint length 3, then the raw bytes verbatim.
    expect([...sink.bytes()]).toEqual([0x03, 0xff, 0x00, 0xfe]);
  });
});

describe("writeFixedString", () => {
  it("round-trips a FixedString(16), preserving trailing NULs", async () => {
    const bytes = await bytesOf("toFixedString('abc', 16)");
    const value = readFixedString(16)(new Cursor(bytes));
    const sink = new Sink();
    writeFixedString(16)(sink, value);
    expect(Buffer.from(sink.bytes())).toEqual(bytes);
  });

  it("throws when the value exceeds the size", () => {
    const sink = new Sink();
    expect(() => writeFixedString(2)(sink, "abc")).toThrow(RangeError);
  });
});

describe("writeFixedStringBytes", () => {
  it("round-trips raw FixedString bytes", async () => {
    const bytes = await bytesOf("toFixedString('abc', 8)");
    const value = readFixedStringBytes(8)(new Cursor(bytes));
    const sink = new Sink();
    writeFixedStringBytes(8)(sink, value);
    expect(Buffer.from(sink.bytes())).toEqual(bytes);
  });

  it("zero-pads a short value", () => {
    const sink = new Sink();
    writeFixedStringBytes(4)(sink, Buffer.from([1, 2]));
    expect([...sink.bytes()]).toEqual([1, 2, 0, 0]);
  });
});
