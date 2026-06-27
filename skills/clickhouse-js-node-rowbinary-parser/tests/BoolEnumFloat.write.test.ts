import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { roundTrip } from "./roundTrip.js";
import { readBool } from "../src/bool.js";
import { writeBool } from "../src/bool.js";
import { readEnum8, readEnum16 } from "../src/enums.js";
import { writeEnum8, writeEnum16 } from "../src/enums.js";
import { readFloat32, readFloat64, readBFloat16 } from "../src/floats.js";
import { writeFloat32, writeFloat64, writeBFloat16 } from "../src/floats.js";

describe("writeBool", () => {
  for (const v of ["true", "false"]) {
    it(`round-trips ${v}`, async () => {
      const bytes = await query(`SELECT ${v}::Bool FORMAT RowBinary`);
      expect(roundTrip(bytes, readBool, writeBool).encoded).toEqual(bytes);
    });
  }
});

describe("writeEnum8 / writeEnum16", () => {
  it("round-trips an Enum8 value", async () => {
    const bytes = await query(
      "SELECT CAST('b', 'Enum8(\\'a\\' = -1, \\'b\\' = 2)') FORMAT RowBinary",
    );
    expect(roundTrip(bytes, readEnum8, writeEnum8).encoded).toEqual(bytes);
  });
  it("round-trips an Enum16 value", async () => {
    const bytes = await query(
      "SELECT CAST('y', 'Enum16(\\'x\\' = -300, \\'y\\' = 30000)') FORMAT RowBinary",
    );
    expect(roundTrip(bytes, readEnum16, writeEnum16).encoded).toEqual(bytes);
  });
});

describe("writeFloat32 / writeFloat64", () => {
  for (const v of ["0", "1.5", "-3.25", "3.4028234663852886e38"]) {
    it(`round-trips toFloat32(${v})`, async () => {
      const bytes = await query(`SELECT toFloat32(${v}) FORMAT RowBinary`);
      expect(roundTrip(bytes, readFloat32, writeFloat32).encoded).toEqual(bytes);
    });
  }
  for (const v of ["0", "1.5", "-3.25", "1.7976931348623157e308"]) {
    it(`round-trips toFloat64(${v})`, async () => {
      const bytes = await query(`SELECT toFloat64(${v}) FORMAT RowBinary`);
      expect(roundTrip(bytes, readFloat64, writeFloat64).encoded).toEqual(bytes);
    });
  }
  it("round-trips Float32 NaN and Infinity", async () => {
    const bytes = await query(
      "SELECT toFloat32(inf) FORMAT RowBinary",
    );
    expect(roundTrip(bytes, readFloat32, writeFloat32).encoded).toEqual(bytes);
  });
});

describe("writeBFloat16", () => {
  for (const v of ["0", "1.5", "-3.25", "100"]) {
    it(`round-trips toBFloat16(${v})`, async () => {
      const bytes = await query(`SELECT toBFloat16(${v}) FORMAT RowBinary`);
      expect(roundTrip(bytes, readBFloat16, writeBFloat16).encoded).toEqual(
        bytes,
      );
    });
  }
});
