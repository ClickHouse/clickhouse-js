import { describe, it, expect } from "vitest";
import { parsedEnumTestArgs } from "../utils/native_columns";
import type {
  ParsedColumnDateTime,
  ParsedColumnDateTime64,
  ParsedColumnFixedString,
  ParsedColumnSimple,
  ParsedColumnTuple,
} from "../../src/parse";
import {
  ColumnTypeParseError,
  parseColumnType,
  parseTupleType,
} from "../../src/parse";

describe("Columns types parser - Tuple", () => {
  it("should parse Tuple with simple types", async () => {
    const args: TestArgs[] = [
      {
        sourceType: "Tuple(String, UInt8)",
        expected: {
          type: "Tuple",
          elements: [
            { type: "Simple", columnType: "String", sourceType: "String" },
            { type: "Simple", columnType: "UInt8", sourceType: "UInt8" },
          ],
          sourceType: "Tuple(String, UInt8)",
        },
      },
      {
        sourceType: "Tuple(Int32, Float32)",
        expected: {
          type: "Tuple",
          elements: [
            { type: "Simple", columnType: "Int32", sourceType: "Int32" },
            { type: "Simple", columnType: "Float32", sourceType: "Float32" },
          ],
          sourceType: "Tuple(Int32, Float32)",
        },
      },
    ];
    args.forEach(({ expected, sourceType }) => {
      const result = parseTupleType({ columnType: sourceType, sourceType });
      expect(
        result,
        `Expected ${sourceType} to have ${joinElements(expected)} elements`,
      ).toEqual(expected);
    });
  });

  it("should parse Tuple with named elements", async () => {
    const args: TestArgs[] = [
      {
        sourceType: "Tuple(s String, i Int64)",
        expected: {
          type: "Tuple",
          elements: [
            { type: "Simple", columnType: "String", sourceType: "String" },
            { type: "Simple", columnType: "Int64", sourceType: "Int64" },
          ],
          sourceType: "Tuple(s String, i Int64)",
        },
      },
      {
        sourceType: 'Tuple(`display name` String, "item count" UInt64)',
        expected: {
          type: "Tuple",
          elements: [
            { type: "Simple", columnType: "String", sourceType: "String" },
            { type: "Simple", columnType: "UInt64", sourceType: "UInt64" },
          ],
          sourceType: 'Tuple(`display name` String, "item count" UInt64)',
        },
      },
    ];
    args.forEach(({ expected, sourceType }) => {
      const result = parseTupleType({ columnType: sourceType, sourceType });
      expect(
        result,
        `Expected ${sourceType} to have ${joinElements(expected)} elements`,
      ).toEqual(expected);
    });
  });

  it("should parse Tuple with Decimals", async () => {
    const args: TestArgs[] = [
      {
        sourceType: "Tuple(Decimal(7, 2), Decimal(18, 4))",
        expected: {
          type: "Tuple",
          elements: [
            {
              type: "Decimal",
              sourceType: "Decimal(7, 2)",
              params: { precision: 7, scale: 2, intSize: 32 },
            },
            {
              type: "Decimal",
              sourceType: "Decimal(18, 4)",
              params: { precision: 18, scale: 4, intSize: 64 },
            },
          ],
          sourceType: "Tuple(Decimal(7, 2), Decimal(18, 4))",
        },
      },
    ];
    args.forEach(({ expected, sourceType }) => {
      const result = parseTupleType({ columnType: sourceType, sourceType });
      expect(
        result,
        `Expected ${sourceType} to have ${joinElements(expected)} elements`,
      ).toEqual(expected);
    });
  });

  it("should parse Tuple with Enums", async () => {
    const args: TestArgs[] = parsedEnumTestArgs.map((enumElement) => {
      // e.g. Tuple(String, Enum8('a' = 1))
      const sourceType = `Tuple(${stringElement.sourceType}, ${enumElement.sourceType})`;
      return {
        sourceType,
        expected: {
          type: "Tuple",
          elements: [stringElement, enumElement],
          sourceType,
        },
      };
    });
    args.forEach(({ expected, sourceType }) => {
      const result = parseTupleType({ columnType: sourceType, sourceType });
      expect(
        result,
        `Expected ${sourceType} to have ${joinElements(expected)} elements`,
      ).toEqual(expected);
    });
  });

  it("should parse Tuple with FixedString/DateTime", async () => {
    const fixedStringElement: ParsedColumnFixedString = {
      type: "FixedString",
      sourceType: "FixedString(16)",
      sizeBytes: 16,
    };
    const dateTimeElement: ParsedColumnDateTime = {
      type: "DateTime",
      timezone: null,
      sourceType: "DateTime",
    };
    const dateTimeWithTimezoneElement: ParsedColumnDateTime = {
      type: "DateTime",
      timezone: "Europe/Amsterdam",
      sourceType: `DateTime('Europe/Amsterdam')`,
    };
    const dateTime64Element: ParsedColumnDateTime64 = {
      type: "DateTime64",
      timezone: null,
      precision: 3,
      sourceType: "DateTime64(3)",
    };
    const dateTime64WithTimezoneElement: ParsedColumnDateTime64 = {
      type: "DateTime64",
      timezone: "Europe/Amsterdam",
      precision: 9,
      sourceType: `DateTime64(9, 'Europe/Amsterdam')`,
    };
    const elements = [
      fixedStringElement,
      dateTimeElement,
      dateTimeWithTimezoneElement,
      dateTime64Element,
      dateTime64WithTimezoneElement,
    ];
    const elementsSourceTypes = elements.map((el) => el.sourceType).join(", ");
    const sourceType = `Tuple(${elementsSourceTypes})`;
    const expected: ParsedColumnTuple = {
      type: "Tuple",
      elements,
      sourceType,
    };
    const result = parseTupleType({ columnType: sourceType, sourceType });
    expect(result).toEqual(expected);
  });

  it.each([
    "`first, last`",
    '"first, last"',
    "`left(parenthesis`",
    '"right)parenthesis"',
    "`apostrophe's name`",
    '"back`tick"',
    "`escaped\\`quote, name`",
    '"escaped\\"quote, name"',
    "`doubled``quote, name`",
    '"doubled""quote, name"',
  ])("should parse a quoted Tuple element named %s", (name) => {
    const sourceType = `Tuple(${name} String, count UInt8)`;
    expect(parseColumnType(sourceType)).toEqual({
      type: "Tuple",
      elements: [
        { type: "Simple", columnType: "String", sourceType: "String" },
        { type: "Simple", columnType: "UInt8", sourceType: "UInt8" },
      ],
      sourceType,
    });
  });

  it.each([
    "`second, name`",
    '"second, name"',
    "`second(parenthesis`",
    '"second)parenthesis"',
  ])("should parse a quoted Tuple element named %s after a comma", (name) => {
    const sourceType = `Tuple(first UInt8, ${name} String, third UInt16)`;
    expect(parseColumnType(sourceType)).toEqual({
      type: "Tuple",
      elements: [
        { type: "Simple", columnType: "UInt8", sourceType: "UInt8" },
        { type: "Simple", columnType: "String", sourceType: "String" },
        { type: "Simple", columnType: "UInt16", sourceType: "UInt16" },
      ],
      sourceType,
    });
  });

  it("should parse nested named Tuple elements", () => {
    const sourceType =
      "Tuple(meta Tuple(name String, count UInt8), price Decimal(7, 2))";
    expect(parseColumnType(sourceType)).toEqual({
      type: "Tuple",
      elements: [
        {
          type: "Tuple",
          elements: [
            { type: "Simple", columnType: "String", sourceType: "String" },
            { type: "Simple", columnType: "UInt8", sourceType: "UInt8" },
          ],
          sourceType: "Tuple(name String, count UInt8)",
        },
        {
          type: "Decimal",
          sourceType: "Decimal(7, 2)",
          params: { precision: 7, scale: 2, intSize: 32 },
        },
      ],
      sourceType,
    });
  });

  it("should preserve spaces inside unnamed Tuple element types", () => {
    const sourceType =
      "Tuple(DateTime64(3, 'Europe/Amsterdam'), Enum8('has space' = 1))";
    expect(parseColumnType(sourceType)).toEqual({
      type: "Tuple",
      elements: [
        {
          type: "DateTime64",
          timezone: "Europe/Amsterdam",
          precision: 3,
          sourceType: "DateTime64(3, 'Europe/Amsterdam')",
        },
        {
          type: "Enum",
          values: { 1: "has space" },
          intSize: 8,
          sourceType: "Enum8('has space' = 1)",
        },
      ],
      sourceType,
    });
  });

  it("should reject unsupported named Tuple element types", () => {
    expect(() => parseColumnType("Tuple(value Unknown)")).toThrow(
      ColumnTypeParseError,
    );
  });

  const stringElement: ParsedColumnSimple = {
    type: "Simple",
    sourceType: "String",
    columnType: "String",
  };
});

function joinElements(expected: ParsedColumnTuple) {
  return expected.elements.map((el) => el.sourceType).join(", ");
}

interface TestArgs {
  sourceType: string;
  expected: ParsedColumnTuple;
}
