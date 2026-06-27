import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { Cursor, Sink } from "../src/core.js";
import {
  readDate,
  readDate32,
  readDateTime,
  readDateTime64,
  readDateTime64P3,
  readDateTime64P6,
  readDateTime64P9,
} from "../src/datetime.js";
import {
  writeDate,
  writeDate32,
  writeDateTime,
  writeDateTime64,
  writeDateTime64P3,
  writeDateTime64P6,
  writeDateTime64P9,
} from "../src/datetime.js";

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

describe("writeDate / writeDate32", () => {
  it("round-trips a Date", async () => {
    const bytes = await query("SELECT toDate('2021-07-07') FORMAT RowBinary");
    expect(rt(bytes, readDate, writeDate)).toEqual(bytes);
  });
  it("round-trips a Date32 (pre-1970)", async () => {
    const bytes = await query("SELECT toDate32('1950-01-02') FORMAT RowBinary");
    expect(rt(bytes, readDate32, writeDate32)).toEqual(bytes);
  });
});

describe("writeDateTime", () => {
  it("round-trips a DateTime", async () => {
    const bytes = await query(
      "SELECT toDateTime('2021-07-07 18:30:00', 'UTC') FORMAT RowBinary",
    );
    expect(rt(bytes, readDateTime, writeDateTime)).toEqual(bytes);
  });
});

describe("writeDateTime64", () => {
  it("round-trips DateTime64(9) via the generic writer", async () => {
    const bytes = await query(
      "SELECT toDateTime64('2021-07-07 18:30:00.123456789', 9, 'UTC') FORMAT RowBinary",
    );
    expect(rt(bytes, readDateTime64(9), writeDateTime64(9))).toEqual(bytes);
  });
  it("round-trips a negative DateTime64(9) instant", async () => {
    const bytes = await query(
      "SELECT toDateTime64('1960-01-01 00:00:00.000000001', 9, 'UTC') FORMAT RowBinary",
    );
    expect(rt(bytes, readDateTime64(9), writeDateTime64(9))).toEqual(bytes);
  });
  it("round-trips DateTime64(3) P3", async () => {
    const bytes = await query(
      "SELECT toDateTime64('2021-07-07 18:30:00.123', 3, 'UTC') FORMAT RowBinary",
    );
    expect(rt(bytes, readDateTime64P3, writeDateTime64P3)).toEqual(bytes);
  });
  it("round-trips DateTime64(6) P6", async () => {
    const bytes = await query(
      "SELECT toDateTime64('2021-07-07 18:30:00.123456', 6, 'UTC') FORMAT RowBinary",
    );
    expect(rt(bytes, readDateTime64P6, writeDateTime64P6)).toEqual(bytes);
  });
  it("round-trips DateTime64(9) P9", async () => {
    const bytes = await query(
      "SELECT toDateTime64('2021-07-07 18:30:00.123456789', 9, 'UTC') FORMAT RowBinary",
    );
    expect(rt(bytes, readDateTime64P9, writeDateTime64P9)).toEqual(bytes);
  });
});
