import { describe, it, expect } from "vitest";
import { parseDateTime64Type, parseDateTimeType } from "../../src/parse";

describe("Columns types parser - DateTime and DateTime64", () => {
  describe("DateTime", () => {
    it("should parse DateTime", async () => {
      const args: [string, string | null][] = [
        ["DateTime", null],
        [`DateTime('GB')`, "GB"],
        [`DateTime('UTC')`, "UTC"],
        [`DateTime('Europe/Amsterdam')`, "Europe/Amsterdam"],
      ];
      args.forEach(([columnType, timezone]) => {
        const result = parseDateTimeType({
          columnType,
          sourceType: columnType,
        });
        expect(
          result,
          `Expected ${columnType} to be parsed as a DateTime`,
        ).toEqual({ type: "DateTime", sourceType: columnType, timezone });
      });
    });

    it("should throw on invalid DateTime", async () => {
      // DateTime('GB') has the least amount of chars allowed for a valid DateTime type.
      const args: [string][] = [
        ["DateTime()"],
        [`DateTime(')`],
        [`DateTime('')`],
        [`DateTime('A')`],
        ["String"],
      ];
      args.forEach(([columnType]) => {
        expect(
          () => parseDateTimeType({ columnType, sourceType: columnType }),
          `Expected ${columnType} to throw`,
        ).toThrowError("Invalid DateTime type");
      });
    });
  });

  describe("DateTime64", () => {
    const precisionRange = [...Array(10).keys()]; // 0..9

    it("should parse DateTime64 without timezone", async () => {
      const args: [string, number][] = precisionRange.map((precision) => [
        `DateTime64(${precision})`,
        precision,
      ]);
      args.forEach(([columnType, precision]) => {
        const result = parseDateTime64Type({
          columnType,
          sourceType: columnType,
        });
        expect(
          result,
          `Expected ${columnType} to be parsed as a DateTime64 with precision ${precision}`,
        ).toEqual({
          type: "DateTime64",
          timezone: null,
          sourceType: columnType,
          precision,
        });
      });
    });

    it("should parse DateTime64 with timezone", async () => {
      const allPrecisionArgs: [string, number, string][][] = precisionRange.map(
        (precision) => [
          [`DateTime64(${precision}, 'GB')`, precision, "GB"],
          [`DateTime64(${precision}, 'UTC')`, precision, "UTC"],
          [`DateTime64(${precision}, 'Etc/GMT-5')`, precision, "Etc/GMT-5"],
        ],
      );
      allPrecisionArgs.forEach((args) =>
        args.forEach(([columnType, precision, timezone]) => {
          const result = parseDateTime64Type({
            columnType,
            sourceType: columnType,
          });
          expect(
            result,
            `Expected ${columnType} to be parsed as a DateTime64 with precision ${precision} and timezone ${timezone}`,
          ).toEqual({
            type: "DateTime64",
            sourceType: columnType,
            timezone,
            precision,
          });
        }),
      );
    });

    it("should throw on invalid DateTime64 type", async () => {
      const args = [["DateTime64("], ["DateTime64()"], ["String"]];
      args.forEach(([columnType]) => {
        expect(
          () => parseDateTime64Type({ columnType, sourceType: columnType }),
          `Expected ${columnType} to throw`,
        ).toThrowError("Invalid DateTime64 type");
      });
    });

    it("should throw on invalid DateTime64 precision", async () => {
      const args = [[`DateTime64(')`], [`DateTime64(foo)`], ["DateTime64(10)"]];
      args.forEach(([columnType]) => {
        expect(
          () => parseDateTime64Type({ columnType, sourceType: columnType }),
          `Expected ${columnType} to throw`,
        ).toThrowError("Invalid DateTime64 precision");
      });
    });

    it("should throw on malformed parameter lists", async () => {
      const args: [string, string][] = [
        ["DateTime64(12, 'UTC')", "Invalid DateTime64 precision"],
        ["DateTime64(10)", "Invalid DateTime64 precision"],
        ["DateTime64(3, UTC)", "Invalid DateTime64 timezone"],
        ["DateTime64(3, 'UTC", "Invalid DateTime64 type"],
        ["DateTime64(3, 'UTC' 'extra')", "Invalid DateTime64 timezone"],
        ["DateTime64(3, )", "Invalid DateTime64 timezone"],
        ["DateTime64(3", "Invalid DateTime64 type"],
        ["DateTime64()", "Invalid DateTime64 type"],
      ];
      args.forEach(([columnType, message]) => {
        expect(
          () => parseDateTime64Type({ columnType, sourceType: columnType }),
          `Expected ${columnType} to throw ${message}`,
        ).toThrowError(message);
      });
    });

    it("should parse multi-digit precision rejection and timezone with comma", async () => {
      const result = parseDateTime64Type({
        columnType: "DateTime64(3, 'Europe/Kiev')",
        sourceType: "DateTime64(3, 'Europe/Kiev')",
      });
      expect(result).toEqual({
        type: "DateTime64",
        timezone: "Europe/Kiev",
        sourceType: "DateTime64(3, 'Europe/Kiev')",
        precision: 3,
      });

      const withComma = parseDateTime64Type({
        columnType: "DateTime64(9, ',')",
        sourceType: "DateTime64(9, ',')",
      });
      expect(withComma.timezone).toBe(",");
    });
  });
});
