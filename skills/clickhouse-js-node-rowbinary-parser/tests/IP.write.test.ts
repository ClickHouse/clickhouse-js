import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { Cursor, Sink } from "../src/core.js";
import {
  readIPv4,
  readIPv6,
  formatIPv4,
  formatIPv6,
} from "../src/ip.js";
import {
  writeIPv4,
  writeIPv6,
  parseIPv4,
  parseIPv6,
} from "../src/ip.js";

describe("writeIPv4 / parseIPv4", () => {
  for (const ip of ["0.0.0.0", "1.2.3.4", "192.168.0.1", "255.255.255.255"]) {
    it(`round-trips ${ip}`, async () => {
      const bytes = await query(`SELECT toIPv4('${ip}') FORMAT RowBinary`);
      const value = readIPv4(new Cursor(bytes));
      expect(formatIPv4(value)).toBe(ip);
      const sink = new Sink();
      writeIPv4(sink, value);
      expect(Buffer.from(sink.bytes())).toEqual(bytes);
      // parseIPv4 is the inverse of formatIPv4.
      const sink2 = new Sink();
      writeIPv4(sink2, parseIPv4(ip));
      expect(Buffer.from(sink2.bytes())).toEqual(bytes);
    });
  }
});

describe("writeIPv6 / parseIPv6", () => {
  for (const ip of [
    "::",
    "::1",
    "2001:db8::1",
    "fe80::a6:6ad3:dba0:1",
    "::ffff:1.2.3.4",
  ]) {
    it(`round-trips ${ip}`, async () => {
      const bytes = await query(`SELECT toIPv6('${ip}') FORMAT RowBinary`);
      const value = readIPv6(new Cursor(bytes));
      const sink = new Sink();
      writeIPv6(sink, value);
      expect(Buffer.from(sink.bytes())).toEqual(bytes);
      // parseIPv6 must reproduce the same wire bytes from the formatted string.
      const sink2 = new Sink();
      writeIPv6(sink2, parseIPv6(formatIPv6(value)));
      expect(Buffer.from(sink2.bytes())).toEqual(bytes);
    });
  }

  it("writeIPv6 rejects non-16-byte input", () => {
    expect(() => writeIPv6(new Sink(), Buffer.alloc(4))).toThrow(RangeError);
  });
});
