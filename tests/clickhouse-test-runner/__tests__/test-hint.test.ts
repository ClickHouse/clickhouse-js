import { describe, expect, it } from "vitest";
import { hintLabel, hintMatches, parseTestHint } from "../src/test-hint.js";

describe("parseTestHint", () => {
  it("parses names and numbers to codes", () => {
    expect(
      parseTestHint("SELECT 1; -- { serverError SYNTAX_ERROR }").serverErrors,
    ).toEqual([62]);
    expect(
      parseTestHint("SELECT 1; -- { serverError 153, 6 }").serverErrors,
    ).toEqual([153, 6]);
  });

  it("parses clientError and error", () => {
    expect(
      parseTestHint("SELECT 1; -- { clientError 62 }").clientErrors,
    ).toEqual([62]);
    const h = parseTestHint("SELECT 1; -- { error 62 }");
    expect(h.serverErrors).toEqual([62]);
    expect(h.clientErrors).toEqual([62]);
  });

  it("supports block comments", () => {
    expect(
      parseTestHint("SELECT 1; /* { serverError 62 } */").serverErrors,
    ).toEqual([62]);
  });

  it("ignores an error hint in a leading comment, but not an echo hint", () => {
    const h = parseTestHint("-- { serverError 62 }\n-- { echo }\nSELECT 1;");
    expect(h.serverErrors).toEqual([]);
    expect(h.echo).toBe(true);
  });

  it("ignores braces in strings", () => {
    expect(
      parseTestHint("SELECT '-- { serverError 62 }';").serverErrors,
    ).toEqual([]);
  });

  it("reports an unknown error name and the retry hint", () => {
    expect(
      parseTestHint("SELECT 1; -- { serverError NO_SUCH_ERROR }").parseError,
    ).toMatch(/NO_SUCH_ERROR/);
    expect(
      parseTestHint("SELECT 1; -- { retry 3 until serverError 62 }").parseError,
    ).toMatch(/retry/);
  });

  it("matches codes and gives a label with names", () => {
    const h = parseTestHint("SELECT 1; -- { serverError SYNTAX_ERROR, 1000 }");
    expect(hintMatches(h, 62)).toBe(true);
    expect(hintMatches(h, 1000)).toBe(true);
    expect(hintMatches(h, 1)).toBe(false);
    expect(hintLabel(h)).toBe("serverError SYNTAX_ERROR, POCO_EXCEPTION");
  });
});
