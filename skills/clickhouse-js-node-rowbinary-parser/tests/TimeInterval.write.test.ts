import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { encode } from "./encode.js";
import {
  writeTime,
  writeTime64,
  parseTime,
  parseTime64,
} from "../src/time_writer.js";
import { writeInterval } from "../src/interval_writer.js";

describe("writeTime", () => {
  /** Encode the parsed seconds-of-day and match ClickHouse's `Time`. */
  function expectTime(literal: string) {
    return async () =>
      expect(encode(writeTime, parseTime(literal))).toEqual(
        await query(
          `SELECT CAST('${literal}' AS Time) SETTINGS enable_time_time64_type = 1 FORMAT RowBinary`,
        ),
      );
  }
  it("encodes 12:34:56", expectTime("12:34:56"));
  it("encodes a negative -01:02:03", expectTime("-01:02:03"));
});

describe("writeTime64", () => {
  it("encodes Time64(3)", async () =>
    expect(encode(writeTime64, parseTime64("12:34:56.789", 3))).toEqual(
      await query(
        "SELECT toTime64('12:34:56.789', 3) SETTINGS enable_time_time64_type = 1 FORMAT RowBinary",
      ),
    ));
  it("encodes a negative Time64(6)", async () =>
    expect(encode(writeTime64, parseTime64("-01:02:03.000004", 6))).toEqual(
      await query(
        "SELECT toTime64('-01:02:03.000004', 6) SETTINGS enable_time_time64_type = 1 FORMAT RowBinary",
      ),
    ));
});

describe("parseTime64", () => {
  it("scales whole seconds and the fraction to ticks", () =>
    expect(parseTime64("12:34:56.789", 3)).toEqual([
      (12n * 3600n + 34n * 60n + 56n) * 1000n + 789n,
      3,
    ]));
  it("handles a negative value with a short fraction", () =>
    expect(parseTime64("-01:02:03.5", 1)).toEqual([
      -((1n * 3600n + 2n * 60n + 3n) * 10n + 5n),
      1,
    ]));
});

describe("writeInterval", () => {
  /** Encode the unit count and match ClickHouse's interval. */
  function expectInterval(expr: string, count: bigint) {
    return async () =>
      expect(encode(writeInterval, count)).toEqual(
        await query(`SELECT ${expr} FORMAT RowBinary`),
      );
  }
  it("encodes toIntervalDay(7)", expectInterval("toIntervalDay(7)", 7n));
  it(
    "encodes a negative toIntervalSecond(-90)",
    expectInterval("toIntervalSecond(-90)", -90n),
  );
  it("encodes toIntervalYear(2)", expectInterval("toIntervalYear(2)", 2n));
});
