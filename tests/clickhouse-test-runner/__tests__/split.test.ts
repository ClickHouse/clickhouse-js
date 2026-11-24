import { describe, expect, it } from "vitest";
import { splitStatements, testTagsLength } from "../src/split.js";

const sqls = (text: string): string[] =>
  splitStatements(text).map((s) => s.sql);

describe("splitStatements", () => {
  it("splits two statements and keeps the ;", () => {
    expect(sqls("SELECT 1; SELECT 2")).toEqual(["SELECT 1;", "SELECT 2"]);
  });

  it("keeps the ; of a single statement", () => {
    expect(sqls("SELECT 1;")).toEqual(["SELECT 1;"]);
  });

  it("returns no statement for empty, blank or comment-only text", () => {
    expect(sqls("")).toEqual([]);
    expect(sqls("   \n\t  ")).toEqual([]);
    expect(sqls("-- only a comment\n/* and another */\n")).toEqual([]);
  });

  it("does not split at a ; in quotes, identifiers and heredocs", () => {
    expect(sqls("SELECT ';'; SELECT \";\"; SELECT `a;b`; SELECT 2")).toEqual([
      "SELECT ';';",
      'SELECT ";";',
      "SELECT `a;b`;",
      "SELECT 2",
    ]);
    expect(sqls("SELECT $doc$it's; a trap$doc$ AS s; SELECT 2")).toEqual([
      "SELECT $doc$it's; a trap$doc$ AS s;",
      "SELECT 2",
    ]);
  });

  it("handles escaped and doubled quotes", () => {
    expect(sqls("SELECT '\\''; SELECT 'a''b'; SELECT 2")).toEqual([
      "SELECT '\\'';",
      "SELECT 'a''b';",
      "SELECT 2",
    ]);
    expect(
      sqls("CREATE TABLE t (`a\\`b` String) ENGINE = Memory; SELECT 1"),
    ).toEqual(["CREATE TABLE t (`a\\`b` String) ENGINE = Memory;", "SELECT 1"]);
  });

  it("ignores ; and quotes in comments, also nested block comments", () => {
    expect(
      sqls("-- it's a; trap\nSELECT 1; /* a /* nested; */ it's; */ SELECT 2"),
    ).toEqual([
      "-- it's a; trap\nSELECT 1;",
      "/* a /* nested; */ it's; */ SELECT 2",
    ]);
  });

  it("treats an unterminated $$ as ordinary characters", () => {
    expect(sqls("SELECT $$; SELECT 2")).toEqual(["SELECT $$;", "SELECT 2"]);
  });

  it("does not split at a ; in parentheses", () => {
    expect(sqls("SELECT (1;2); SELECT 3")).toEqual([
      "SELECT (1;2);",
      "SELECT 3",
    ]);
  });

  it("skips the -- Tags: header", () => {
    const text = "-- Tags: no-fasttest\n-- no-fasttest: reason\n\nSELECT 1;";
    expect(testTagsLength(text)).toBe(text.indexOf("\n\nSELECT") + 1);
    const [st] = splitStatements(text);
    expect(st?.sql).toBe("SELECT 1;");
  });

  it("puts the same-line comment after the ; into full, not into sql", () => {
    const [a, b] = splitStatements(
      "SELECT 1; -- { serverError 1 }\nSELECT 2; -- next\n",
    );
    expect(a?.sql).toBe("SELECT 1;");
    expect(a?.full).toBe("SELECT 1; -- { serverError 1 }");
    expect(b?.full).toBe("SELECT 2; -- next");
  });

  it("ends the inline data of INSERT ... FORMAT at an empty line", () => {
    const text = [
      "INSERT INTO t FORMAT CSV 1,a",
      "2,b;c",
      "",
      "SELECT * FROM t;",
    ].join("\n");
    expect(sqls(text)).toEqual([
      "INSERT INTO t FORMAT CSV 1,a\n2,b;c",
      "SELECT * FROM t;",
    ]);
  });

  it("does not take FORMAT Values or a column named format as inline data", () => {
    expect(sqls("INSERT INTO t FORMAT Values (1);\nSELECT 1;")).toEqual([
      "INSERT INTO t FORMAT Values (1);",
      "SELECT 1;",
    ]);
    expect(sqls("INSERT INTO t SELECT format FROM s;\nSELECT 1;")).toEqual([
      "INSERT INTO t SELECT format FROM s;",
      "SELECT 1;",
    ]);
  });
});

describe("hints and echo of statements", () => {
  it("reads an error hint after the ;", () => {
    const [st] = splitStatements("SELECT 1; -- { serverError SYNTAX_ERROR }");
    expect(st?.hint.serverErrors).toEqual([62]);
  });

  it("reads an error hint after the last statement without ;", () => {
    // 00161_rounding_functions ends like this.
    const [, st] = splitStatements(
      "SELECT 1;\nSELECT ceil(1, -54212) --{serverError ARGUMENT_OUT_OF_BOUND}\n",
    );
    expect(st?.sql).toBe(
      "SELECT ceil(1, -54212) --{serverError ARGUMENT_OUT_OF_BOUND}",
    );
    expect(st?.hint.serverErrors).toEqual([69]);
  });

  it("ignores an error hint in a leading comment", () => {
    const [st] = splitStatements("-- { serverError 1 }\nSELECT 1;");
    expect(st?.hint.serverErrors).toEqual([]);
  });

  it("does not give the hint of one statement to the next", () => {
    const [a, b] = splitStatements(
      "SELECT 1; -- { serverError 1 }\nSELECT 2;\n",
    );
    expect(a?.hint.serverErrors).toEqual([1]);
    expect(b?.hint.serverErrors).toEqual([]);
  });

  it("turns echo on and off for the following statements", () => {
    const st = splitStatements(
      "SELECT 0;\n-- { echoOn }\nSELECT 1;\nSELECT 2;\n-- { echoOff }\nSELECT 3;",
    );
    expect(st.map((s) => s.echo)).toEqual([false, true, true, false]);
    expect(st[1]?.full).toBe("-- { echoOn }\nSELECT 1;");
  });

  it("echoes the rest of the text for the last statement without ;", () => {
    const st = splitStatements("-- { echo }\nSELECT 1\n\n");
    expect(st[0]?.full).toBe("-- { echo }\nSELECT 1\n\n");
  });
});
