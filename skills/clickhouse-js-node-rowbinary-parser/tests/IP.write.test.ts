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

/** The RowBinary bytes ClickHouse emits for `fn('ip')` — the source of truth. */
function chBytes(fn: string, ip: string): Promise<Buffer> {
  return query(`SELECT ${fn}('${ip}') FORMAT RowBinary`);
}

describe("writeIPv4", () => {
  it("encodes 0.0.0.0", async () =>
    expect(encode(writeIPv4, parseIPv4("0.0.0.0"))).toEqual(
      await chBytes("toIPv4", "0.0.0.0"),
    ));
  it("encodes 1.2.3.4", async () =>
    expect(encode(writeIPv4, parseIPv4("1.2.3.4"))).toEqual(
      await chBytes("toIPv4", "1.2.3.4"),
    ));
  it("encodes 192.168.0.1", async () =>
    expect(encode(writeIPv4, parseIPv4("192.168.0.1"))).toEqual(
      await chBytes("toIPv4", "192.168.0.1"),
    ));
  it("encodes 255.255.255.255", async () =>
    expect(encode(writeIPv4, parseIPv4("255.255.255.255"))).toEqual(
      await chBytes("toIPv4", "255.255.255.255"),
    ));
});

describe("parseIPv4", () => {
  it("packs the dotted quad big-endian", () =>
    expect(parseIPv4("1.2.3.4")).toBe(0x01020304));
  it("rejects an out-of-range octet", () =>
    expect(() => parseIPv4("1.2.3.256")).toThrow(RangeError));
});

describe("writeIPv6", () => {
  it("encodes ::", async () =>
    expect(encode(writeIPv6, parseIPv6("::"))).toEqual(
      await chBytes("toIPv6", "::"),
    ));
  it("encodes ::1", async () =>
    expect(encode(writeIPv6, parseIPv6("::1"))).toEqual(
      await chBytes("toIPv6", "::1"),
    ));
  it("encodes 2001:db8::1", async () =>
    expect(encode(writeIPv6, parseIPv6("2001:db8::1"))).toEqual(
      await chBytes("toIPv6", "2001:db8::1"),
    ));
  it("encodes fe80::a6:6ad3:dba0:1", async () =>
    expect(encode(writeIPv6, parseIPv6("fe80::a6:6ad3:dba0:1"))).toEqual(
      await chBytes("toIPv6", "fe80::a6:6ad3:dba0:1"),
    ));
  it("encodes the IPv4-mapped ::ffff:1.2.3.4", async () =>
    expect(encode(writeIPv6, parseIPv6("::ffff:1.2.3.4"))).toEqual(
      await chBytes("toIPv6", "::ffff:1.2.3.4"),
    ));

  it("rejects non-16-byte input", () =>
    expect(() =>
      writeIPv6(new Sink(Buffer.allocUnsafe(16)), Buffer.alloc(4)),
    ).toThrow(RangeError));
});
