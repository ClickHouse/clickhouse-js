import { describe, expect, it } from "vitest";
import {
  buildStatements,
  errorMatchesExpectation,
  parseHintComment,
} from "../src/test-hint.js";
import { splitQueries } from "../src/split-queries.js";

const statements = (sql: string) => buildStatements(splitQueries(sql));

describe("parseHintComment", () => {
  it("parses a named serverError hint", () => {
    const hint = parseHintComment(
      "-- { serverError SIZES_OF_ARRAYS_DONT_MATCH }",
    );
    expect(hint).not.toBeNull();
    expect([...hint!.names]).toEqual(["SIZES_OF_ARRAYS_DONT_MATCH"]);
    expect([...hint!.codes]).toEqual([]);
    expect(hint!.label).toBe("serverError SIZES_OF_ARRAYS_DONT_MATCH");
  });

  it("parses a numeric serverError hint", () => {
    const hint = parseHintComment("-- { serverError 190 }");
    expect([...hint!.codes]).toEqual(["190"]);
    expect([...hint!.names]).toEqual([]);
  });

  it("parses a comma-separated list of codes", () => {
    const hint = parseHintComment("-- { serverError 153, 6 }");
    expect([...hint!.codes].sort()).toEqual(["153", "6"]);
  });

  it("parses a clientError hint", () => {
    const hint = parseHintComment("-- { clientError SYNTAX_ERROR }");
    expect([...hint!.names]).toEqual(["SYNTAX_ERROR"]);
  });

  it("supports block comments", () => {
    const hint = parseHintComment("/* { serverError 241 } */");
    expect([...hint!.codes]).toEqual(["241"]);
  });

  it("returns null for non-error hints", () => {
    expect(parseHintComment("-- { echoOn }")).toBeNull();
    expect(parseHintComment("-- a plain comment")).toBeNull();
    expect(parseHintComment("-- { unterminated")).toBeNull();
  });
});

describe("buildStatements", () => {
  it("leaves un-annotated statements without an expectation", () => {
    expect(statements("SELECT 1; SELECT 2")).toEqual([
      { sql: "SELECT 1", expectedError: null },
      { sql: "SELECT 2", expectedError: null },
    ]);
  });

  it("attaches a trailing hint to the preceding statement", () => {
    expect(
      statements(
        "SELECT throwIf(1); -- { serverError FUNCTION_THROW_IF_VALUE_IS_NON_ZERO }\nSELECT 2;",
      ),
    ).toEqual([
      {
        sql: "SELECT throwIf(1)",
        expectedError: {
          label: "serverError FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
          codes: new Set(),
          names: new Set(["FUNCTION_THROW_IF_VALUE_IS_NON_ZERO"]),
        },
      },
      {
        sql: "-- { serverError FUNCTION_THROW_IF_VALUE_IS_NON_ZERO }\nSELECT 2",
        expectedError: null,
      },
    ]);
  });

  it("attaches a hint left dangling after the final statement", () => {
    expect(statements("SELECT bad(); -- { serverError 42 }")).toEqual([
      {
        sql: "SELECT bad()",
        expectedError: {
          label: "serverError 42",
          codes: new Set(["42"]),
          names: new Set(),
        },
      },
    ]);
  });

  it("ignores a leading hint with no preceding statement", () => {
    expect(statements("-- { serverError 42 }\nSELECT 1;")).toEqual([
      { sql: "-- { serverError 42 }\nSELECT 1", expectedError: null },
    ]);
  });

  it("attaches consecutive hints to their own statements", () => {
    const result = statements(
      "SELECT a; -- { serverError 1 }\nSELECT b; -- { serverError 2 }\nSELECT c;",
    );
    expect(result.map((s) => s.sql.includes("SELECT a"))).toContain(true);
    const a = result.find((s) => s.sql.endsWith("SELECT a"))!;
    const b = result.find((s) => s.sql.includes("SELECT b"))!;
    const c = result.find((s) => s.sql.includes("SELECT c"))!;
    expect([...a.expectedError!.codes]).toEqual(["1"]);
    expect([...b.expectedError!.codes]).toEqual(["2"]);
    expect(c.expectedError).toBeNull();
  });
});

describe("errorMatchesExpectation", () => {
  const expected = parseHintComment(
    "-- { serverError SIZES_OF_ARRAYS_DONT_MATCH }",
  )!;

  it("matches by error type name", () => {
    expect(
      errorMatchesExpectation(
        { code: "190", type: "SIZES_OF_ARRAYS_DONT_MATCH" },
        expected,
      ),
    ).toBe(true);
  });

  it("matches by numeric code", () => {
    const byCode = parseHintComment("-- { serverError 190 }")!;
    expect(errorMatchesExpectation({ code: "190" }, byCode)).toBe(true);
    expect(errorMatchesExpectation({ code: 190 }, byCode)).toBe(true);
  });

  it("does not match a different error", () => {
    expect(
      errorMatchesExpectation({ code: "60", type: "UNKNOWN_TABLE" }, expected),
    ).toBe(false);
  });

  it("does not match non-error values", () => {
    expect(errorMatchesExpectation(null, expected)).toBe(false);
    expect(errorMatchesExpectation("boom", expected)).toBe(false);
  });
});
