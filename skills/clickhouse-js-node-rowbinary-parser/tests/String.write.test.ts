import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { encode } from "./encode.js";
import {
  writeString,
  writeFixedString,
  writeFixedStringBytes,
} from "../src/strings_writer.js";

describe("writeString", () => {
  /** Encode the JS string and match ClickHouse's RowBinary for `'literal'`. */
  function expectString(literal: string, value: string) {
    return async () =>
      expect(encode(writeString, value)).toEqual(
        await query(`SELECT ${literal} FORMAT RowBinary`),
      );
  }
  it("encodes the empty string", expectString("''", ""));
  it("encodes an ASCII string", expectString("'hello'", "hello"));
  it(
    "encodes a multi-byte UTF-8 string",
    expectString("'héllo · 日本'", "héllo · 日本"),
  );
  it(
    "encodes a string longer than a 1-byte varint length",
    expectString("repeat('x', 300)", "x".repeat(300)),
  );

  it("writes raw (non-UTF-8) bytes from a Uint8Array", () => {
    // varint length 3, then the raw bytes verbatim.
    expect([...encode(writeString, Buffer.from([0xff, 0x00, 0xfe]))]).toEqual([
      0x03, 0xff, 0x00, 0xfe,
    ]);
  });
});

describe("writeFixedString", () => {
  it("pads to the column width with trailing NULs", async () =>
    expect(encode(writeFixedString(16), "abc")).toEqual(
      await query("SELECT toFixedString('abc', 16) FORMAT RowBinary"),
    ));

  it("throws when the value exceeds the size", () =>
    expect(() => encode(writeFixedString(2), "abc")).toThrow(RangeError));
});

describe("writeFixedStringBytes", () => {
  it("pads raw bytes to the column width with trailing NULs", async () =>
    expect(encode(writeFixedStringBytes(8), Buffer.from("abc"))).toEqual(
      await query("SELECT toFixedString('abc', 8) FORMAT RowBinary"),
    ));

  it("zero-pads a short value", () =>
    expect([...encode(writeFixedStringBytes(4), Buffer.from([1, 2]))]).toEqual([
      1, 2, 0, 0,
    ]));

  it("throws when the value exceeds the size", () =>
    expect(() =>
      encode(writeFixedStringBytes(2), Buffer.from([1, 2, 3])),
    ).toThrow(RangeError));
});
