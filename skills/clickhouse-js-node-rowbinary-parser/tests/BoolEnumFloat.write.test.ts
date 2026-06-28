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
  it("encodes 0", async () =>
    expect(encode(writeFloat32, 0)).toEqual(
      await query("SELECT toFloat32(0) FORMAT RowBinary"),
    ));
  it("encodes 1.5", async () =>
    expect(encode(writeFloat32, 1.5)).toEqual(
      await query("SELECT toFloat32(1.5) FORMAT RowBinary"),
    ));
  it("encodes -3.25", async () =>
    expect(encode(writeFloat32, -3.25)).toEqual(
      await query("SELECT toFloat32(-3.25) FORMAT RowBinary"),
    ));
  it("encodes the max finite float32", async () =>
    expect(encode(writeFloat32, 3.4028234663852886e38)).toEqual(
      await query("SELECT toFloat32(3.4028234663852886e38) FORMAT RowBinary"),
    ));
  it("encodes Infinity", async () =>
    expect(encode(writeFloat32, Infinity)).toEqual(
      await query("SELECT toFloat32(inf) FORMAT RowBinary"),
    ));
});

describe("writeFloat64", () => {
  it("encodes 0", async () =>
    expect(encode(writeFloat64, 0)).toEqual(
      await query("SELECT toFloat64(0) FORMAT RowBinary"),
    ));
  it("encodes 1.5", async () =>
    expect(encode(writeFloat64, 1.5)).toEqual(
      await query("SELECT toFloat64(1.5) FORMAT RowBinary"),
    ));
  it("encodes -3.25", async () =>
    expect(encode(writeFloat64, -3.25)).toEqual(
      await query("SELECT toFloat64(-3.25) FORMAT RowBinary"),
    ));
  it("encodes the max finite float64", async () =>
    expect(encode(writeFloat64, 1.7976931348623157e308)).toEqual(
      await query("SELECT toFloat64(1.7976931348623157e308) FORMAT RowBinary"),
    ));
});

describe("writeBFloat16", () => {
  it("encodes 0", async () =>
    expect(encode(writeBFloat16, 0)).toEqual(
      await query("SELECT toBFloat16(0) FORMAT RowBinary"),
    ));
  it("encodes 1.5", async () =>
    expect(encode(writeBFloat16, 1.5)).toEqual(
      await query("SELECT toBFloat16(1.5) FORMAT RowBinary"),
    ));
  it("encodes -3.25", async () =>
    expect(encode(writeBFloat16, -3.25)).toEqual(
      await query("SELECT toBFloat16(-3.25) FORMAT RowBinary"),
    ));
  it("encodes 100", async () =>
    expect(encode(writeBFloat16, 100)).toEqual(
      await query("SELECT toBFloat16(100) FORMAT RowBinary"),
    ));
});
