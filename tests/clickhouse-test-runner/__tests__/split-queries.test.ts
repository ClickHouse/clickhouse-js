import { describe, expect, it } from "vitest";
import { splitQueries } from "../src/split-queries.js";

describe("splitQueries", () => {
  it("splits two simple statements", () => {
    expect(splitQueries("SELECT 1; SELECT 2")).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });

  it("ignores a trailing semicolon", () => {
    expect(splitQueries("SELECT 1;")).toEqual(["SELECT 1"]);
  });

  it("handles a single statement without trailing semicolon", () => {
    expect(splitQueries("SELECT 1")).toEqual(["SELECT 1"]);
  });

  it("returns [] for an empty string", () => {
    expect(splitQueries("")).toEqual([]);
  });

  it("returns [] for whitespace-only input", () => {
    expect(splitQueries("   \n\t  ")).toEqual([]);
  });

  it("does not split on semicolons inside single quotes", () => {
    expect(splitQueries("SELECT ';'; SELECT 2")).toEqual([
      "SELECT ';'",
      "SELECT 2",
    ]);
  });

  it("does not split on semicolons inside double quotes", () => {
    expect(splitQueries('SELECT ";"; SELECT 2')).toEqual([
      'SELECT ";"',
      "SELECT 2",
    ]);
  });

  it("does not split on semicolons inside backticks", () => {
    expect(splitQueries("SELECT `a;b`; SELECT 2")).toEqual([
      "SELECT `a;b`",
      "SELECT 2",
    ]);
  });

  it("handles escaped quote inside a single-quoted string", () => {
    expect(splitQueries("SELECT '\\''; SELECT 2")).toEqual([
      "SELECT '\\''",
      "SELECT 2",
    ]);
  });

  it("trims whitespace around statements", () => {
    expect(splitQueries("  SELECT 1  ;  SELECT 2  ")).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });

  it("ignores apostrophes and semicolons inside line comments", () => {
    const sql =
      "-- defeat the test's purpose; really\nSELECT 1;\nSYSTEM FLUSH LOGS query_log;\nSELECT 2";
    expect(splitQueries(sql)).toEqual([
      "-- defeat the test's purpose; really\nSELECT 1",
      "SYSTEM FLUSH LOGS query_log",
      "SELECT 2",
    ]);
  });

  it("ignores apostrophes and semicolons inside block comments", () => {
    const sql = "/* it's a; trap */ SELECT 1; SELECT 2";
    expect(splitQueries(sql)).toEqual([
      "/* it's a; trap */ SELECT 1",
      "SELECT 2",
    ]);
  });

  it("does not split on quotes or semicolons inside a $$ heredoc", () => {
    // Condensed 03032_save_bad_json_escape_sequences: the heredoc body holds
    // double quotes and backslashes that must not toggle the quote state.
    const sql = [
      "select * from format(JSONEachRow, $$",
      '{"key" : "\\u"}',
      '{"key" : "\\ud800\\"}',
      "$$);",
      "SELECT 2;",
    ].join("\n");
    expect(splitQueries(sql)).toEqual([
      [
        "select * from format(JSONEachRow, $$",
        '{"key" : "\\u"}',
        '{"key" : "\\ud800\\"}',
        "$$)",
      ].join("\n"),
      "SELECT 2",
    ]);
  });

  it("does not split on quotes or semicolons inside a $tag$ heredoc", () => {
    expect(
      splitQueries("SELECT $doc$it's; a trap$doc$ AS s; SELECT 2"),
    ).toEqual(["SELECT $doc$it's; a trap$doc$ AS s", "SELECT 2"]);
  });

  it("keeps the boundaries of statements that follow a heredoc", () => {
    // 02685_bson2 and friends: the heredoc body itself contains an apostrophe.
    expect(splitQueries("SELECT $$it's$$; SELECT 2; SELECT 3")).toEqual([
      "SELECT $$it's$$",
      "SELECT 2",
      "SELECT 3",
    ]);
  });

  it("treats an unterminated $$ as ordinary characters", () => {
    expect(splitQueries("SELECT $$; SELECT 2")).toEqual([
      "SELECT $$",
      "SELECT 2",
    ]);
  });

  it("does not treat other bare words starting with $ as heredocs", () => {
    expect(splitQueries("SELECT $foo, '$bar'; SELECT 2")).toEqual([
      "SELECT $foo, '$bar'",
      "SELECT 2",
    ]);
  });

  it("handles a backslash-escaped backtick in a quoted identifier", () => {
    // 04097_tuple_inside_nullable_subcolumn_descendants: the escaped backtick
    // used to close the identifier early, leaving the identifier open and
    // merging the rest of the file into one statement.
    const sql =
      "CREATE TABLE t (tup Nullable(Tuple(`a\\`b` Nullable(String)))) ENGINE = Memory;" +
      " SELECT 1; SELECT 2";
    expect(splitQueries(sql)).toEqual([
      "CREATE TABLE t (tup Nullable(Tuple(`a\\`b` Nullable(String)))) ENGINE = Memory",
      "SELECT 1",
      "SELECT 2",
    ]);
  });
});
