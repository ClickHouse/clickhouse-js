import { describe, it, expect } from "vitest";
import {
  ClickHouseError,
  enhanceStackTrace,
  getCurrentStackTrace,
  parseError,
} from "../../src/index";

describe("parseError", () => {
  it("parses a single line error", () => {
    const message = `Code: 62.DB::Exception: Syntax error: failed at position 15 ('unknown_table') (line 1, col 15): unknown_table FORMAT JSON. Expected alias cannot be here. (SYNTAX_ERROR) (version 22.7.1.2484 (official build))`;
    const error = parseError(message) as ClickHouseError;

    expect(error).toBeInstanceOf(ClickHouseError);
    expect(error.code).toBe("62");
    expect(error.type).toBe("SYNTAX_ERROR");
    expect(error.message).toBe(
      `Syntax error: failed at position 15 ('unknown_table') (line 1, col 15): unknown_table FORMAT JSON. Expected alias cannot be here. `,
    );
  });

  // With a JSON-family output format, the server may report an error through
  // that format: on 24.8 for every error, on later versions for an error raised
  // while the result is written. These are the response shapes seen for each
  // format, possibly after other rows (column names, types, data).
  describe("unwraps an error returned through a JSON format", () => {
    const text = `Code: 62. DB::Exception: Syntax error: failed at position 8 ('a"b'): a"b. (SYNTAX_ERROR) (version 24.8.14.39 (official build))`;
    const quoted = JSON.stringify(text);
    it.each([
      ["JSONEachRow", `{"exception": ${quoted}}\n`],
      ["compact JSONEachRow", `{"exception":${quoted}}`],
      [
        "JSONEachRow, after data rows",
        `{"n":0,"exception":"not an error"}\n{"n":1,"exception":"not an error"}\n{"exception": ${quoted}}\n`,
      ],
      [
        "JSON / JSONCompact / JSONStrings",
        `{\n\t"meta":\n\t[\n\n\t],\n\n\t"data":\n\t[\n\n\t],\n\n\t"rows": 0,\n\n\t"exception": ${quoted}\n}\n`,
      ],
      [
        "JSONCompact, after data rows",
        `{"meta":[{"name":"exception","type":"String"}],"data":[["not an error"]],"rows":1,"exception":${quoted}}`,
      ],
      ["JSONObjectEachRow", `{\n\t"exception": ${quoted}\n}\n`],
      ["JSONCompactEachRow", `[${quoted}]\n`],
      [
        "JSONCompactEachRow, after data rows",
        `[0, "not an error"]\n["not an error"]\n[${quoted}]\n`,
      ],
      // the column names come before the exception (24.8 and later)
      ["JSONCompactEachRowWithNames", `["n", "exception"]\n[${quoted}]\n`],
      [
        "JSONCompactEachRowWithNamesAndTypes",
        `["n", "exception"]\n["UInt64", "UInt8"]\n[${quoted}]\n`,
      ],
      ["JSONCompactEachRowWithNames (24.8, empty names)", `[]\n[${quoted}]\n`],
      // 24.8 wraps the exception in a row; later versions write it at the top level
      ["JSONEachRowWithProgress (24.8)", `{"row":{"exception": ${quoted}}}\n`],
      [
        "JSONEachRowWithProgress",
        `{"meta":[{"name":"n","type":"UInt64"}]}\n{"row":{"n":0}}\n{"exception":${quoted}}\n`,
      ],
    ])("%s", (_, body) => {
      const error = parseError(body) as ClickHouseError;

      expect(error).toBeInstanceOf(ClickHouseError);
      expect(error.code).toBe("62");
      expect(error.type).toBe("SYNTAX_ERROR");
      expect(error.message).toBe(
        `Syntax error: failed at position 8 ('a"b'): a"b. `,
      );
    });
  });

  it.each([
    ["a malformed JSON error", `{"exception": "Code: 62. DB::Exception: oops`],
    [
      "a data value in a column named exception",
      `{"exception":"not an error"}\n`,
    ],
    ["a one-column data row", `["not an error"]\n`],
    [
      "a data row wrapped in a row key",
      `{"row":{"exception":"not an error"}}\n`,
    ],
  ])("keeps %s as is", (_, body) => {
    const error = parseError(body);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ClickHouseError);
    expect(error.message).toBe(body);
  });

  it("parses a multiline error", () => {
    const message = `Code: 62.DB::Exception: Syntax error: failed at position 15 ('unknown_table') (line 1, col 15): unknown_table
    FORMAT JSON. Expected alias cannot be here. (SYNTAX_ERROR) (version 22.7.1.2484 (official build))`;
    const error = parseError(message) as ClickHouseError;

    expect(error).toBeInstanceOf(ClickHouseError);
    expect(error.code).toBe("62");
    expect(error.type).toBe("SYNTAX_ERROR");
    expect(error.message).toBe(
      `Syntax error: failed at position 15 ('unknown_table') (line 1, col 15): unknown_table
    FORMAT JSON. Expected alias cannot be here. `,
    );
  });

  it("should handle replica message corner case", () => {
    const message = `Code: 285. DB::Exception: Number of alive replicas (2) is less than requested quorum (3). (TOO_FEW_LIVE_REPLICAS) (version 22.8.1.11291 (official build))`;
    const error = parseError(message) as ClickHouseError;

    expect(error).toBeInstanceOf(ClickHouseError);
    expect(error.code).toBe("285");
    expect(error.type).toBe("TOO_FEW_LIVE_REPLICAS");
    expect(error.message).toBe(
      "Number of alive replicas (2) is less than requested quorum (3). ",
    );
  });

  describe("error codes with numbers", () => {
    it("should work with S3_ERROR", () => {
      const message = `Code: 499. DB::Exception: Could not list objects in bucket my-bucket with prefix my-organization, S3 exception: Some S3 error, message: Could not list objects. (S3_ERROR) (version 22.8.1.11291 (official build))`;
      const error = parseError(message) as ClickHouseError;

      expect(error).toBeInstanceOf(ClickHouseError);
      expect(error.code).toBe("499");
      expect(error.type).toBe("S3_ERROR");
      expect(error.message).toBe(
        "Could not list objects in bucket my-bucket with prefix my-organization, S3 exception: Some S3 error, message: Could not list objects. ",
      );
    });

    it("should work with BZIP2_STREAM_DECODER_FAILED", () => {
      const message = `Code: 594. DB::Exception: bzip2 stream encoder init failed: error code: 42 (BZIP2_STREAM_DECODER_FAILED) (version 22.8.1.11291 (official build))`;
      const error = parseError(message) as ClickHouseError;

      expect(error).toBeInstanceOf(ClickHouseError);
      expect(error.code).toBe("594");
      expect(error.type).toBe("BZIP2_STREAM_DECODER_FAILED");
      expect(error.message).toBe(
        "bzip2 stream encoder init failed: error code: 42 ",
      );
    });

    it("should work with LZ4_ENCODER_FAILED", () => {
      const message = `Code: 617. DB::Exception: creation of LZ4 compression context failed. LZ4F version: 1.9.3 (LZ4_ENCODER_FAILED) (version 22.8.1.11291 (official build))`;
      const error = parseError(message) as ClickHouseError;

      expect(error).toBeInstanceOf(ClickHouseError);
      expect(error.code).toBe("617");
      expect(error.type).toBe("LZ4_ENCODER_FAILED");
      expect(error.message).toBe(
        "creation of LZ4 compression context failed. LZ4F version: 1.9.3 ",
      );
    });
  });

  describe("getCurrentStackTrace", () => {
    it("should trim the stack trace as expected", async () => {
      const currentStack = getCurrentStackTrace();
      expect(currentStack.split("\n").length).toBeGreaterThanOrEqual(3);
      expect(currentStack).not.toContain(getCurrentStackTrace.name);
      expect(currentStack).not.toContain("Error:");
      expect(currentStack).not.toContain("UserContext");
      expect(currentStack).not.toContain("error.test.ts");
    });
  });

  describe("enhanceStackTrace", () => {
    it("should no-op on an empty error or stack trace", async () => {
      const err = new Error("test error");
      err.stack = undefined;

      const result1 = enhanceStackTrace(err, "ignored");
      expect(result1.stack).toBeUndefined();
      expect(result1.message).toBe("test error");

      err.stack = "";
      const result2 = enhanceStackTrace(err, "ignored");
      expect(result2.stack).toBe("");
      expect(result2.message).toBe("test error");
    });

    it("should enhance the stack trace of an error", () => {
      const err = new Error("test error");
      err.stack = "foo\n";
      const stackTrace = "bar\n";
      const enhancedError = enhanceStackTrace(err, stackTrace);

      expect(enhancedError.stack).toContain(`foo\nbar\n`);
      expect(enhancedError.message).toBe("test error");
    });
  });

  describe("Cluster mode errors", () => {
    it("should work with TABLE_ALREADY_EXISTS", async () => {
      const message = `Code: 57. DB::Exception: There was an error on [clickhouse2:9000]: Code: 57. DB::Exception: Table default.command_test_2a751694160745f5aebe586c90b27515 already exists. (TABLE_ALREADY_EXISTS) (version 22.6.5.22 (official build)). (TABLE_ALREADY_EXISTS) (version 22.6.5.22 (official build))`;
      const error = parseError(message) as ClickHouseError;

      expect(error).toBeInstanceOf(ClickHouseError);
      expect(error.code).toBe("57");
      expect(error.type).toBe("TABLE_ALREADY_EXISTS");
      expect(error.message).toBe(
        "Table default.command_test_2a751694160745f5aebe586c90b27515 already exists. ",
      );
    });
  });
});
