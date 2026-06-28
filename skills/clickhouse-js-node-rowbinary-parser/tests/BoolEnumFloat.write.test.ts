import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { encode } from "./encode.js";
import { writeBool } from "../src/bool_writer.js";
import { writeEnum8, writeEnum16 } from "../src/enums_writer.js";
import {
  writeFloat32,
  writeFloat64,
  writeBFloat16,
} from "../src/floats_writer.js";

describe("writeBool", () => {
  it("encodes true as 0x01", async () =>
    expect(encode(writeBool, true)).toEqual(
      await query("SELECT true::Bool FORMAT RowBinary"),
    ));
  it("encodes false as 0x00", async () =>
    expect(encode(writeBool, false)).toEqual(
      await query("SELECT false::Bool FORMAT RowBinary"),
    ));
});

describe("writeEnum8 / writeEnum16", () => {
  it("encodes an Enum8 value as its underlying Int8", async () =>
    expect(encode(writeEnum8, 2)).toEqual(
      await query(
        "SELECT CAST('b', 'Enum8(\\'a\\' = -1, \\'b\\' = 2)') FORMAT RowBinary",
      ),
    ));
  it("encodes an Enum16 value as its underlying Int16", async () =>
    expect(encode(writeEnum16, 30000)).toEqual(
      await query(
        "SELECT CAST('y', 'Enum16(\\'x\\' = -300, \\'y\\' = 30000)') FORMAT RowBinary",
      ),
    ));
});

describe("writeFloat32", () => {
  /** Encode `value` and assert it matches ClickHouse's `toFloat32`. */
  function expectFloat32(sql: string, value: number) {
    return async () =>
      expect(encode(writeFloat32, value)).toEqual(
        await query(`SELECT toFloat32(${sql}) FORMAT RowBinary`),
      );
  }
  it("encodes 0", expectFloat32("0", 0));
  it("encodes 1.5", expectFloat32("1.5", 1.5));
  it("encodes -3.25", expectFloat32("-3.25", -3.25));
  it(
    "encodes the max finite float32",
    expectFloat32("3.4028234663852886e38", 3.4028234663852886e38),
  );
  it("encodes Infinity", expectFloat32("inf", Infinity));
});

describe("writeFloat64", () => {
  function expectFloat64(sql: string, value: number) {
    return async () =>
      expect(encode(writeFloat64, value)).toEqual(
        await query(`SELECT toFloat64(${sql}) FORMAT RowBinary`),
      );
  }
  it("encodes 0", expectFloat64("0", 0));
  it("encodes 1.5", expectFloat64("1.5", 1.5));
  it("encodes -3.25", expectFloat64("-3.25", -3.25));
  it(
    "encodes the max finite float64",
    expectFloat64("1.7976931348623157e308", 1.7976931348623157e308),
  );
});

describe("writeBFloat16", () => {
  function expectBFloat16(sql: string, value: number) {
    return async () =>
      expect(encode(writeBFloat16, value)).toEqual(
        await query(`SELECT toBFloat16(${sql}) FORMAT RowBinary`),
      );
  }
  it("encodes 0", expectBFloat16("0", 0));
  it("encodes 1.5", expectBFloat16("1.5", 1.5));
  it("encodes -3.25", expectBFloat16("-3.25", -3.25));
  it("encodes 100", expectBFloat16("100", 100));
});
