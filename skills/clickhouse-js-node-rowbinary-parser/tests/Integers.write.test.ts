import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { roundTrip } from "./roundTrip.js";
import type { Reader, Writer } from "../src/core.js";
import {
  readUInt8,
  readInt8,
  readUInt16,
  readInt16,
  readUInt32,
  readInt32,
  readUInt64,
  readInt64,
  readUInt128,
  readInt128,
  readUInt256,
  readInt256,
} from "../src/integers.js";
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
} from "../src/integers.js";

/** Pair a reader with its matching writer into a byte-level round-trip closure. */
function rt<T>(read: Reader<T>, write: Writer<T>): (bytes: Buffer) => Buffer {
  return (bytes) => roundTrip(bytes, read, write).encoded;
}

interface IntCase {
  name: string;
  cast: string;
  rt: (bytes: Buffer) => Buffer;
  values: string[];
}

const cases: IntCase[] = [
  { name: "UInt8", cast: "toUInt8", rt: rt(readUInt8, writeUInt8), values: ["0", "255"] },
  { name: "Int8", cast: "toInt8", rt: rt(readInt8, writeInt8), values: ["-128", "0", "127"] },
  { name: "UInt16", cast: "toUInt16", rt: rt(readUInt16, writeUInt16), values: ["0", "65535"] },
  { name: "Int16", cast: "toInt16", rt: rt(readInt16, writeInt16), values: ["-32768", "0", "32767"] },
  { name: "UInt32", cast: "toUInt32", rt: rt(readUInt32, writeUInt32), values: ["0", "4294967295"] },
  { name: "Int32", cast: "toInt32", rt: rt(readInt32, writeInt32), values: ["-2147483648", "0", "2147483647"] },
  { name: "UInt64", cast: "toUInt64", rt: rt(readUInt64, writeUInt64), values: ["0", "18446744073709551615"] },
  { name: "Int64", cast: "toInt64", rt: rt(readInt64, writeInt64), values: ["-9223372036854775808", "0", "9223372036854775807"] },
  { name: "UInt128", cast: "toUInt128", rt: rt(readUInt128, writeUInt128), values: ["0", "340282366920938463463374607431768211455"] },
  { name: "Int128", cast: "toInt128", rt: rt(readInt128, writeInt128), values: ["-170141183460469231731687303715884105728", "0", "170141183460469231731687303715884105727"] },
  { name: "UInt256", cast: "toUInt256", rt: rt(readUInt256, writeUInt256), values: ["0", "115792089237316195423570985008687907853269984665640564039457584007913129639935"] },
  { name: "Int256", cast: "toInt256", rt: rt(readInt256, writeInt256), values: ["-57896044618658097711785492504343953926634992332820282019728792003956564819968", "0", "57896044618658097711785492504343953926634992332820282019728792003956564819967"] },
];

for (const c of cases) {
  describe(`write${c.name}`, () => {
    for (const v of c.values) {
      it(`round-trips ${c.cast}(${v})`, async () => {
        const bytes = await query(`SELECT ${c.cast}('${v}') FORMAT RowBinary`);
        expect(c.rt(bytes)).toEqual(bytes);
      });
    }
  });
}
