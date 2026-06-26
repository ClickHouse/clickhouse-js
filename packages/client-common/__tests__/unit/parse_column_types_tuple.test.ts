import { describe, it, expect } from "vitest";
import { parsedEnumTestArgs } from "../utils/native_columns";
import type {
  ParsedColumnDateTime,
  ParsedColumnDateTime64,
  ParsedColumnFixedString,
  ParsedColumnSimple,
  ParsedColumnTuple,
} from "../../src/parse";
import { parseColumnType, parseTupleType } from "../../src/parse";

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

  // TODO: Simple types permutations, Nullable, Arrays, Maps, Nested Tuples

  const stringElement: ParsedColumnSimple = {
    type: "Simple",
    sourceType: "String",
    columnType: "String",
  };
});

describe("Columns types parser - named Tuple", () => {
  it("should parse a named Tuple (as returned by DESCRIBE TABLE)", () => {
    // Regression test for https://github.com/ClickHouse/clickhouse-java/issues/889
    // (mirrored in clickhouse-js): named Tuple elements `<name> <Type>` used to
    // throw `Unsupported column type` because the name was not stripped.
    const sourceType = "Tuple(s String, i Int64)";
    const expected: ParsedColumnTuple = {
      type: "Tuple",
      elements: [
        { type: "Simple", columnType: "String", sourceType: "String" },
        { type: "Simple", columnType: "Int64", sourceType: "Int64" },
      ],
      elementNames: ["s", "i"],
      sourceType,
    };
    expect(parseColumnType(sourceType)).toEqual(expected);
  });

  it("should parse nested named Tuples and keep names at each level", () => {
    const sourceType =
      "Tuple(arr Array(Int64), inner Tuple(x UInt8, y String))";
    const expected: ParsedColumnTuple = {
      type: "Tuple",
      elements: [
        {
          type: "Array",
          value: { type: "Simple", columnType: "Int64", sourceType: "Int64" },
          dimensions: 1,
          sourceType: "Array(Int64)",
        },
        {
          type: "Tuple",
          elements: [
            { type: "Simple", columnType: "UInt8", sourceType: "UInt8" },
            { type: "Simple", columnType: "String", sourceType: "String" },
          ],
          elementNames: ["x", "y"],
          sourceType: "Tuple(x UInt8, y String)",
        },
      ],
      elementNames: ["arr", "inner"],
      sourceType,
    };
    expect(parseColumnType(sourceType)).toEqual(expected);
  });

  it("should parse backtick-quoted element names with commas/parens", () => {
    // ClickHouse backtick-quotes element names that contain special characters;
    // the comma inside the name must not split the elements.
    const sourceType = "Tuple(`a,b` Int64, c UInt8)";
    const expected: ParsedColumnTuple = {
      type: "Tuple",
      elements: [
        { type: "Simple", columnType: "Int64", sourceType: "Int64" },
        { type: "Simple", columnType: "UInt8", sourceType: "UInt8" },
      ],
      elementNames: ["a,b", "c"],
      sourceType,
    };
    expect(parseColumnType(sourceType)).toEqual(expected);
  });

  it("should parse a named Tuple nested inside an Array", () => {
    // The element name must be stripped when the named Tuple is reached via a
    // container type (Array(Tuple(...))), not only at the top level.
    const sourceType = "Array(Tuple(s String, i Int64))";
    expect(parseColumnType(sourceType)).toEqual({
      type: "Array",
      value: {
        type: "Tuple",
        elements: [
          { type: "Simple", columnType: "String", sourceType: "String" },
          { type: "Simple", columnType: "Int64", sourceType: "Int64" },
        ],
        elementNames: ["s", "i"],
        sourceType: "Tuple(s String, i Int64)",
      },
      dimensions: 1,
      sourceType,
    });
  });

  it("should take a backtick-quoted name containing a backslash verbatim", () => {
    // ClickHouse emits backslashes inside backtick-quoted names verbatim, so the
    // name spans literally up to the closing backtick (no unescaping).
    const sourceType = "Tuple(`a\\b` Int64)";
    const expected: ParsedColumnTuple = {
      type: "Tuple",
      elements: [{ type: "Simple", columnType: "Int64", sourceType: "Int64" }],
      elementNames: ["a\\b"],
      sourceType,
    };
    expect(parseColumnType(sourceType)).toEqual(expected);
  });

  it("should not set elementNames for unnamed Tuples", () => {
    // Contrast case: unnamed Tuples must keep their previous shape (no names).
    const result = parseColumnType("Tuple(String, UInt8)") as ParsedColumnTuple;
    expect(result.elementNames).toBeUndefined();
    expect(result.elements).toEqual([
      { type: "Simple", columnType: "String", sourceType: "String" },
      { type: "Simple", columnType: "UInt8", sourceType: "UInt8" },
    ]);
  });
});

function joinElements(expected: ParsedColumnTuple) {
  return expected.elements.map((el) => el.sourceType).join(", ");
}

interface TestArgs {
  sourceType: string;
  expected: ParsedColumnTuple;
}
