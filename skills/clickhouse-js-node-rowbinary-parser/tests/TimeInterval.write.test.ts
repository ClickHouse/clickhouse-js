import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { Cursor, Sink } from "../src/core.js";
import {
  readTime,
  readTime64,
  formatTime,
  formatTime64,
} from "../src/time.js";
import { writeTime, writeTime64, parseTime, parseTime64 } from "../src/time.js";
import { readInterval } from "../src/interval.js";
import { writeInterval } from "../src/interval.js";

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

describe("writeTime", () => {
  for (const v of ["12:34:56", "-01:02:03"]) {
    it(`round-trips ${v}`, async () => {
      const bytes = await query(
        `SELECT CAST('${v}' AS Time) SETTINGS enable_time_time64_type = 1 FORMAT RowBinary`,
      );
      expect(rt(bytes, readTime, writeTime)).toEqual(bytes);
      // parseTime is the inverse of formatTime.
      expect(formatTime(parseTime(v))).toBe(
        formatTime(readTime(new Cursor(bytes))),
      );
    });
  }
});

describe("writeTime64", () => {
  it("round-trips Time64(3)", async () => {
    const bytes = await query(
      "SELECT toTime64('12:34:56.789', 3) SETTINGS enable_time_time64_type = 1 FORMAT RowBinary",
    );
    expect(rt(bytes, readTime64(3), writeTime64)).toEqual(bytes);
  });
  it("round-trips a negative Time64(6)", async () => {
    const bytes = await query(
      "SELECT toTime64('-01:02:03.000004', 6) SETTINGS enable_time_time64_type = 1 FORMAT RowBinary",
    );
    expect(rt(bytes, readTime64(6), writeTime64)).toEqual(bytes);
  });
  it("parseTime64 inverts formatTime64", () => {
    expect(parseTime64("12:34:56.789", 3)).toEqual([
      (12n * 3600n + 34n * 60n + 56n) * 1000n + 789n,
      3,
    ]);
    expect(formatTime64(parseTime64("-01:02:03.5", 1))).toBe("-01:02:03.5");
  });
});

describe("writeInterval", () => {
  for (const expr of [
    "toIntervalDay(7)",
    "toIntervalSecond(-90)",
    "toIntervalYear(2)",
  ]) {
    it(`round-trips ${expr}`, async () => {
      const bytes = await query(`SELECT ${expr} FORMAT RowBinary`);
      expect(rt(bytes, readInterval, writeInterval)).toEqual(bytes);
    });
  }
});
