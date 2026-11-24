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

  // The message can contain `(UPPERCASE)` groups before the real type: a type
  // name, a token of a syntax error, or NULL. The type is the group before
  // ` (version ...)`.
  it.each([
    {
      name: "a type name in the message",
      text: `Code: 43. DB::Exception: First argument for function tupleElement must be Tuple, Nullable(Tuple), QBit, JSON, Nullable(JSON) or array of these. Actual UInt8: In scope SELECT tupleElement(1, 'a'). (ILLEGAL_TYPE_OF_ARGUMENT) (version 26.10.4.207 (official build))`,
      code: "43",
      type: "ILLEGAL_TYPE_OF_ARGUMENT",
      message: `First argument for function tupleElement must be Tuple, Nullable(Tuple), QBit, JSON, Nullable(JSON) or array of these. Actual UInt8: In scope SELECT tupleElement(1, 'a'). `,
    },
    {
      name: "a token of a syntax error",
      text: `Code: 62. DB::Exception: Syntax error: failed at position 38 (TABLE): TABLE y. Expected one of: DISK, VOLUME, SHARD. (SYNTAX_ERROR) (version 26.10.4.207 (official build))`,
      code: "62",
      type: "SYNTAX_ERROR",
      message: `Syntax error: failed at position 38 (TABLE): TABLE y. Expected one of: DISK, VOLUME, SHARD. `,
    },
    {
      name: "(NULL)",
      text: `Code: 62. DB::Exception: Syntax error: failed at position 34 (NULL): NULL. Expected one of: token, end of query. (SYNTAX_ERROR) (version 26.10.4.207 (official build))`,
      code: "62",
      type: "SYNTAX_ERROR",
      message: `Syntax error: failed at position 34 (NULL): NULL. Expected one of: token, end of query. `,
    },
  ])("parses the type after $name", ({ text, code, type, message }) => {
    const error = parseError(text) as ClickHouseError;
    expect(error).toBeInstanceOf(ClickHouseError);
    expect(error.code).toBe(code);
    expect(error.type).toBe(type);
    expect(error.message).toBe(message);
  });

  it("gives the type of the outer exception for a wrapped exception", () => {
    const error = parseError(
      `Code: 636. DB::Exception: The table structure cannot be extracted from a JSONEachRow format file. Error:\nCode: 117. DB::Exception: Duplicate column name found while schema inference: "x". (INCORRECT_DATA) (version 26.10.4.207 (official build)).\nYou can specify the structure manually. (CANNOT_EXTRACT_TABLE_STRUCTURE) (version 26.10.4.207 (official build))\n`,
    ) as ClickHouseError;
    expect(error).toBeInstanceOf(ClickHouseError);
    expect(error.code).toBe("636");
    expect(error.type).toBe("CANNOT_EXTRACT_TABLE_STRUCTURE");
  });

  // With the setting `stacktrace`, the server adds the stack after the type.
  it("parses the type before a stack trace", () => {
    const error = parseError(
      `Code: 43. DB::Exception: First argument for function tupleElement must be Tuple, Nullable(Tuple), QBit, JSON, Nullable(JSON) or array of these. Actual UInt8: In scope SELECT tupleElement(1, 'a'). (ILLEGAL_TYPE_OF_ARGUMENT), Stack trace (when copying this message, always include the lines below):\n\n0. DB::Exception::Exception(DB::Exception::MessageMasked&&, int, bool) @ 0x000000001604dca4\n1. DB::Exception::Exception(PreformattedMessage&&, int) @ 0x000000000b7c4c90 (version 26.10.4.207 (official build))\n`,
    ) as ClickHouseError;
    expect(error).toBeInstanceOf(ClickHouseError);
    expect(error.code).toBe("43");
    expect(error.type).toBe("ILLEGAL_TYPE_OF_ARGUMENT");
    expect(error.message).toBe(
      "First argument for function tupleElement must be Tuple, Nullable(Tuple), QBit, JSON, Nullable(JSON) or array of these. Actual UInt8: In scope SELECT tupleElement(1, 'a'). ",
    );
  });

  it("keeps a stack trace marker that is part of the message", () => {
    const error = parseError(
      `Code: 395. DB::Exception: bad, Stack trace (not a stack). (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 26.10.4.207 (official build))`,
    ) as ClickHouseError;
    expect(error).toBeInstanceOf(ClickHouseError);
    expect(error.code).toBe("395");
    expect(error.type).toBe("FUNCTION_THROW_IF_VALUE_IS_NON_ZERO");
    expect(error.message).toBe("bad, Stack trace (not a stack). ");
  });

  it("gives the outer type of a wrapped exception before a stack trace", () => {
    const error = parseError(
      `Code: 636. DB::Exception: The table structure cannot be extracted from a JSONEachRow format file. Error:\nCode: 117. DB::Exception: Duplicate column name found while schema inference: "x". (INCORRECT_DATA) (version 26.10.4.207 (official build)).\nYou can specify the structure manually. (CANNOT_EXTRACT_TABLE_STRUCTURE), Stack trace (when copying this message, always include the lines below):\n\n0. DB::Exception::Exception(DB::Exception::MessageMasked&&, int, bool) @ 0x000000001604dca4\n`,
    ) as ClickHouseError;
    expect(error.code).toBe("636");
    expect(error.type).toBe("CANNOT_EXTRACT_TABLE_STRUCTURE");
  });

  // The parser must stay fast on a large text without a type at the end of an
  // exception: a regex with backtracking took seconds for this input.
  it("parses a large text in linear time", () => {
    const text =
      "Code: 62. DB::Exception: broken (SYNTAX_ERROR)\n".repeat(20_000) +
      "__exception__";
    const started = performance.now();
    const error = parseError(text) as ClickHouseError;
    expect(performance.now() - started).toBeLessThan(500);
    expect(error.code).toBe("62");
    expect(error.type).toBe("SYNTAX_ERROR");
    expect(error.message).toBe("broken ");
  });

  it("returns a plain Error for a text that is not a server error", () => {
    const html = "<html><body>(BAD_GATEWAY) Code: 502</body></html>";
    const error = parseError(html);
    expect(error).not.toBeInstanceOf(ClickHouseError);
    expect(error.message).toBe(html);
  });

  // The server leaves out ` (version ...)` for a request with a `session_id`.
  it("parses the type at the end of a text without a version", () => {
    const error = parseError(
      `Code: 62. DB::Exception: Syntax error: failed at position 38 (TABLE): TABLE y. Expected one of: DISK, VOLUME, SHARD. (SYNTAX_ERROR)\n`,
    ) as ClickHouseError;
    expect(error).toBeInstanceOf(ClickHouseError);
    expect(error.code).toBe("62");
    expect(error.type).toBe("SYNTAX_ERROR");
    expect(error.message).toBe(
      "Syntax error: failed at position 38 (TABLE): TABLE y. Expected one of: DISK, VOLUME, SHARD. ",
    );
  });

  it("takes the first (TYPE) group when the type is not at the end", () => {
    const error = parseError(
      `1\n2\nCode: 62. DB::Exception: Syntax error. (SYNTAX_ERROR)\n__exception__`,
    ) as ClickHouseError;
    expect(error).toBeInstanceOf(ClickHouseError);
    expect(error.type).toBe("SYNTAX_ERROR");
    expect(error.message).toBe("Syntax error. ");
  });

  // The server cuts an exception block to 16 KiB, so a long message has no
  // (TYPE) and no ` (version ...)` at the end.
  it("parses the code of a message that the server cut before the type", () => {
    const message =
      "Code: 395. DB::Exception: boom Exception: " + "x".repeat(100);
    const error = parseError(`${message}'. (FUNCTIO`) as ClickHouseError;
    expect(error).toBeInstanceOf(ClickHouseError);
    expect(error.code).toBe("395");
    expect(error.type).toBeUndefined();
    expect(error.message).toBe(
      "boom Exception: " + "x".repeat(100) + "'. (FUNCTIO",
    );
  });

  it("returns a plain Error without a type when the text does not start as a server error", () => {
    const text = "Proxy failure. Error: 502. Upstream Exception: timeout";
    const error = parseError(text);
    expect(error).not.toBeInstanceOf(ClickHouseError);
    expect(error.message).toBe(text);
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
