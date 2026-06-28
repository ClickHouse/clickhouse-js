import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { encode } from "./encode.js";
import { Sink } from "../src/core_writer.js";
import {
  writeIPv4,
  writeIPv6,
  parseIPv4,
  parseIPv6,
} from "../src/ip_writer.js";

describe("writeIPv4", () => {
  /** Encode the parsed address and match ClickHouse's `toIPv4`. */
  function expectIPv4(ip: string) {
    return async () =>
      expect(encode(writeIPv4, parseIPv4(ip))).toEqual(
        await query(`SELECT toIPv4('${ip}') FORMAT RowBinary`),
      );
  }
  it("encodes 0.0.0.0", expectIPv4("0.0.0.0"));
  it("encodes 1.2.3.4", expectIPv4("1.2.3.4"));
  it("encodes 192.168.0.1", expectIPv4("192.168.0.1"));
  it("encodes 255.255.255.255", expectIPv4("255.255.255.255"));
});

describe("parseIPv4", () => {
  it("packs the dotted quad big-endian", () =>
    expect(parseIPv4("1.2.3.4")).toBe(0x01020304));
  it("rejects an out-of-range octet", () =>
    expect(() => parseIPv4("1.2.3.256")).toThrow(RangeError));
});

describe("writeIPv6", () => {
  function expectIPv6(ip: string) {
    return async () =>
      expect(encode(writeIPv6, parseIPv6(ip))).toEqual(
        await query(`SELECT toIPv6('${ip}') FORMAT RowBinary`),
      );
  }
  it("encodes ::", expectIPv6("::"));
  it("encodes ::1", expectIPv6("::1"));
  it("encodes 2001:db8::1", expectIPv6("2001:db8::1"));
  it("encodes fe80::a6:6ad3:dba0:1", expectIPv6("fe80::a6:6ad3:dba0:1"));
  it("encodes the IPv4-mapped ::ffff:1.2.3.4", expectIPv6("::ffff:1.2.3.4"));

  it("rejects non-16-byte input", () =>
    expect(() =>
      writeIPv6(new Sink(Buffer.allocUnsafe(16)), Buffer.alloc(4)),
    ).toThrow(RangeError));
});
