import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { encode } from "./encode.js";
import {
  writeDecimal32,
  writeDecimal64,
  writeDecimal128,
  writeDecimal256,
  parseDecimal,
} from "../src/decimals_writer.js";
import { type DecimalValue } from "../src/decimals.js";
import { type Writer } from "../src/core_writer.js";

/** Encode `value` (built from a string via parseDecimal) and match ClickHouse. */
function expectDecimal(
  type: string,
  scale: number,
  write: Writer<DecimalValue>,
  literal: string,
) {
  return async () =>
    expect(encode(write, parseDecimal(literal, scale))).toEqual(
      await query(`SELECT CAST('${literal}', '${type}') FORMAT RowBinary`),
    );
}

describe("writeDecimal32", () => {
  it("encodes 1.5", expectDecimal("Decimal32(4)", 4, writeDecimal32, "1.5"));
  it(
    "encodes -12345.6789",
    expectDecimal("Decimal32(4)", 4, writeDecimal32, "-12345.6789"),
  );
  it("encodes 0", expectDecimal("Decimal32(4)", 4, writeDecimal32, "0"));
});

describe("writeDecimal64", () => {
  it("encodes 1.50", expectDecimal("Decimal64(2)", 2, writeDecimal64, "1.50"));
  it(
    "encodes -9999999999.99",
    expectDecimal("Decimal64(2)", 2, writeDecimal64, "-9999999999.99"),
  );
});

describe("writeDecimal128", () => {
  it(
    "encodes 3.1415926535",
    expectDecimal("Decimal128(10)", 10, writeDecimal128, "3.1415926535"),
  );
  it(
    "encodes -1.0000000001",
    expectDecimal("Decimal128(10)", 10, writeDecimal128, "-1.0000000001"),
  );
});

describe("writeDecimal256", () => {
  it(
    "encodes 2.71828182845904523536",
    expectDecimal(
      "Decimal256(20)",
      20,
      writeDecimal256,
      "2.71828182845904523536",
    ),
  );
  it(
    "encodes -0.00000000000000000001",
    expectDecimal(
      "Decimal256(20)",
      20,
      writeDecimal256,
      "-0.00000000000000000001",
    ),
  );
});

describe("parseDecimal", () => {
  it("scales the integer and fraction parts", () =>
    expect(parseDecimal("1.5000", 4)).toEqual([15000n, 4]));
  it("handles a negative value", () =>
    expect(parseDecimal("-12345.6789", 4)).toEqual([-123456789n, 4]));
  it("handles zero", () => expect(parseDecimal("0.00", 2)).toEqual([0n, 2]));
  it("right-pads a short fraction to the scale", () =>
    expect(parseDecimal("1.5", 4)).toEqual([15000n, 4]));
  it("truncates a fraction longer than the scale", () =>
    expect(parseDecimal("1.56789", 2)).toEqual([156n, 2]));
});
