import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { roundTrip } from "./roundTrip.js";
import {
  readDecimal32,
  readDecimal64,
  readDecimal128,
  readDecimal256,
  formatDecimal,
  parseDecimal,
} from "../src/decimals.js";
import {
  writeDecimal32,
  writeDecimal64,
  writeDecimal128,
  writeDecimal256,
} from "../src/decimals.js";

describe("writeDecimal*", () => {
  const cases = [
    { name: "Decimal32", type: "Decimal32(4)", scale: 4, read: readDecimal32, write: writeDecimal32, values: ["1.5", "-12345.6789", "0"] },
    { name: "Decimal64", type: "Decimal64(2)", scale: 2, read: readDecimal64, write: writeDecimal64, values: ["1.50", "-9999999999.99", "0"] },
    { name: "Decimal128", type: "Decimal128(10)", scale: 10, read: readDecimal128, write: writeDecimal128, values: ["3.1415926535", "-1.0000000001"] },
    { name: "Decimal256", type: "Decimal256(20)", scale: 20, read: readDecimal256, write: writeDecimal256, values: ["2.71828182845904523536", "-0.00000000000000000001"] },
  ];
  for (const c of cases) {
    for (const v of c.values) {
      it(`${c.name} round-trips ${v}`, async () => {
        const bytes = await query(
          `SELECT CAST('${v}', '${c.type}') FORMAT RowBinary`,
        );
        expect(roundTrip(bytes, c.read(c.scale), c.write).encoded).toEqual(
          bytes,
        );
      });
    }
  }
});

describe("parseDecimal", () => {
  it("is the inverse of formatDecimal", () => {
    expect(parseDecimal("1.5000", 4)).toEqual([15000n, 4]);
    expect(parseDecimal("-12345.6789", 4)).toEqual([-123456789n, 4]);
    expect(parseDecimal("0.00", 2)).toEqual([0n, 2]);
    expect(formatDecimal(parseDecimal("3.14", 2))).toBe("3.14");
  });
  it("pads a short fraction and truncates a long one", () => {
    expect(parseDecimal("1.5", 4)).toEqual([15000n, 4]);
    expect(parseDecimal("1.56789", 2)).toEqual([156n, 2]);
  });
});
