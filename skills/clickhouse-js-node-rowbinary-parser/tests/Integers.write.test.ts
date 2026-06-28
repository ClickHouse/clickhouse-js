import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { encode } from "./encode.js";
import {
  writeUInt8,
  writeInt8,
  writeUInt16,
  writeInt16,
  writeUInt32,
  writeInt32,
  writeUInt64,
  writeInt64,
  writeUInt128,
  writeInt128,
  writeUInt256,
  writeInt256,
} from "../src/integers_writer.js";

/** The RowBinary bytes ClickHouse emits for `cast('literal')` — the source of truth. */
function chBytes(cast: string, literal: string): Promise<Buffer> {
  return query(`SELECT ${cast}('${literal}') FORMAT RowBinary`);
}

describe("writeUInt8", () => {
  it("encodes 0", async () =>
    expect(encode(writeUInt8, 0)).toEqual(await chBytes("toUInt8", "0")));
  it("encodes 255", async () =>
    expect(encode(writeUInt8, 255)).toEqual(await chBytes("toUInt8", "255")));
});

describe("writeInt8", () => {
  it("encodes -128", async () =>
    expect(encode(writeInt8, -128)).toEqual(await chBytes("toInt8", "-128")));
  it("encodes 0", async () =>
    expect(encode(writeInt8, 0)).toEqual(await chBytes("toInt8", "0")));
  it("encodes 127", async () =>
    expect(encode(writeInt8, 127)).toEqual(await chBytes("toInt8", "127")));
});

describe("writeUInt16", () => {
  it("encodes 0", async () =>
    expect(encode(writeUInt16, 0)).toEqual(await chBytes("toUInt16", "0")));
  it("encodes 65535", async () =>
    expect(encode(writeUInt16, 65535)).toEqual(
      await chBytes("toUInt16", "65535"),
    ));
});

describe("writeInt16", () => {
  it("encodes -32768", async () =>
    expect(encode(writeInt16, -32768)).toEqual(
      await chBytes("toInt16", "-32768"),
    ));
  it("encodes 32767", async () =>
    expect(encode(writeInt16, 32767)).toEqual(
      await chBytes("toInt16", "32767"),
    ));
});

describe("writeUInt32", () => {
  it("encodes 0", async () =>
    expect(encode(writeUInt32, 0)).toEqual(await chBytes("toUInt32", "0")));
  it("encodes 4294967295", async () =>
    expect(encode(writeUInt32, 4294967295)).toEqual(
      await chBytes("toUInt32", "4294967295"),
    ));
});

describe("writeInt32", () => {
  it("encodes -2147483648", async () =>
    expect(encode(writeInt32, -2147483648)).toEqual(
      await chBytes("toInt32", "-2147483648"),
    ));
  it("encodes 2147483647", async () =>
    expect(encode(writeInt32, 2147483647)).toEqual(
      await chBytes("toInt32", "2147483647"),
    ));
});

describe("writeUInt64", () => {
  it("encodes 0", async () =>
    expect(encode(writeUInt64, 0n)).toEqual(await chBytes("toUInt64", "0")));
  it("encodes 2^64 - 1", async () =>
    expect(encode(writeUInt64, 18446744073709551615n)).toEqual(
      await chBytes("toUInt64", "18446744073709551615"),
    ));
});

describe("writeInt64", () => {
  it("encodes -2^63", async () =>
    expect(encode(writeInt64, -9223372036854775808n)).toEqual(
      await chBytes("toInt64", "-9223372036854775808"),
    ));
  it("encodes 2^63 - 1", async () =>
    expect(encode(writeInt64, 9223372036854775807n)).toEqual(
      await chBytes("toInt64", "9223372036854775807"),
    ));
});

describe("writeUInt128", () => {
  it("encodes 0", async () =>
    expect(encode(writeUInt128, 0n)).toEqual(await chBytes("toUInt128", "0")));
  it("encodes 2^128 - 1", async () =>
    expect(
      encode(writeUInt128, 340282366920938463463374607431768211455n),
    ).toEqual(
      await chBytes("toUInt128", "340282366920938463463374607431768211455"),
    ));
});

describe("writeInt128", () => {
  it("encodes -2^127", async () =>
    expect(
      encode(writeInt128, -170141183460469231731687303715884105728n),
    ).toEqual(
      await chBytes("toInt128", "-170141183460469231731687303715884105728"),
    ));
  it("encodes 2^127 - 1", async () =>
    expect(
      encode(writeInt128, 170141183460469231731687303715884105727n),
    ).toEqual(
      await chBytes("toInt128", "170141183460469231731687303715884105727"),
    ));
});

describe("writeUInt256", () => {
  it("encodes 0", async () =>
    expect(encode(writeUInt256, 0n)).toEqual(await chBytes("toUInt256", "0")));
  it("encodes 2^256 - 1", async () =>
    expect(
      encode(
        writeUInt256,
        115792089237316195423570985008687907853269984665640564039457584007913129639935n,
      ),
    ).toEqual(
      await chBytes(
        "toUInt256",
        "115792089237316195423570985008687907853269984665640564039457584007913129639935",
      ),
    ));
});

describe("writeInt256", () => {
  it("encodes -2^255", async () =>
    expect(
      encode(
        writeInt256,
        -57896044618658097711785492504343953926634992332820282019728792003956564819968n,
      ),
    ).toEqual(
      await chBytes(
        "toInt256",
        "-57896044618658097711785492504343953926634992332820282019728792003956564819968",
      ),
    ));
  it("encodes 2^255 - 1", async () =>
    expect(
      encode(
        writeInt256,
        57896044618658097711785492504343953926634992332820282019728792003956564819967n,
      ),
    ).toEqual(
      await chBytes(
        "toInt256",
        "57896044618658097711785492504343953926634992332820282019728792003956564819967",
      ),
    ));
});
