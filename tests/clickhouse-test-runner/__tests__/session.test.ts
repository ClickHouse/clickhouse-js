import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.js";
import {
  parseSetAssignments,
  parseUseDatabase,
} from "../src/backends/shared.js";

describe("--param_<name>", () => {
  it("is a query parameter, not a setting", () => {
    const a = parseArgs([
      "--param_CLICKHOUSE_DATABASE=test_abc",
      "--param_x",
      "7",
      "--max_threads=2",
    ]);
    expect(a.params).toEqual({ CLICKHOUSE_DATABASE: "test_abc", x: "7" });
    expect(a.serverSettings).not.toHaveProperty("param_x");
  });
});

describe("parseUseDatabase", () => {
  it("reads plain, quoted and parameter names", () => {
    expect(parseUseDatabase("USE system;", {})).toBe("system");
    expect(parseUseDatabase("use `my db` -- c\n;", {})).toBe("my db");
    expect(parseUseDatabase("USE DATABASE d1;", {})).toBe("d1");
    expect(
      parseUseDatabase("USE {CLICKHOUSE_DATABASE:Identifier};", {
        CLICKHOUSE_DATABASE: "test_x",
      }),
    ).toBe("test_x");
    expect(parseUseDatabase("USE a b;", {})).toBeNull();
  });
});

describe("parseSetAssignments", () => {
  it("reads each assignment, also with commas in values", () => {
    expect(
      parseSetAssignments(
        "SET max_threads = 1, session_timezone = 'Asia/Tokyo', s = 'a,b';",
      ),
    ).toEqual({
      max_threads: "1",
      session_timezone: "Asia/Tokyo",
      s: "a,b",
    });
  });
});
