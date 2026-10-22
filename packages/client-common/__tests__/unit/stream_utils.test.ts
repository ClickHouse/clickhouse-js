import { describe, it, expect } from "vitest";
import {
  ClickHouseError,
  canHaveInBandExceptionRow,
  extractErrorAtTheEndOfChunk,
  extractInBandExceptionFromRow,
} from "../../src/index";
import { assertError, inBandExceptionMessage } from "../fixtures/stream_errors";

describe("utils/stream", () => {
  const errMsg = "boom";
  const tag = "FOOBAR";

  it("should handle a valid error chunk", async () => {
    const chunk = buildValidErrorChunk(errMsg, tag);

    const err = extractErrorAtTheEndOfChunk(chunk, tag);
    expect(err).toBeDefined();
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toBe(errMsg);
  });

  it("should handle a broken chunk", async () => {
    const chunk = new TextEncoder().encode(
      "\r\nsome random data \nthat does not conform\r\t to the protocol\r\n",
    );

    const err = extractErrorAtTheEndOfChunk(chunk, tag);
    expect(err).toBeDefined();
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain("error in the stream");
  });

  it("should handle a partial of a valid chunk", async () => {
    const chunk = buildValidErrorChunk(errMsg, tag).slice(0, 20);

    const err = extractErrorAtTheEndOfChunk(chunk, tag);
    expect(err).toBeDefined();
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain("error in the stream");
  });
});

describe("utils/stream - in-band exception row", () => {
  const exceptionRow = `{"exception": ${JSON.stringify(inBandExceptionMessage)}}`;

  it("should parse the exception row written by the server", async () => {
    const err = extractInBandExceptionFromRow(exceptionRow);
    expect(err).toBeInstanceOf(ClickHouseError);
    assertError(err!);
    expect((err as ClickHouseError).type).toBe(
      "FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
    );
  });

  it("should handle escaped characters in the message", async () => {
    const err = extractInBandExceptionFromRow(
      `{"exception": ${JSON.stringify('Code: 62. DB::Exception: Syntax error: "foo"\n\\bar. (SYNTAX_ERROR) (version 25.8.1.1)')}}`,
    );
    expect(err).toBeInstanceOf(ClickHouseError);
    expect((err as ClickHouseError).code).toBe("62");
    expect(err!.message).toContain('"foo"\n\\bar');
  });

  it("should not treat a genuine column named exception as an error", async () => {
    // `SELECT '<message>' AS exception FORMAT JSONEachRow` is written without
    // a space after the colon, even if the value looks like a server error
    for (const row of [
      `{"exception":"boom"}`,
      `{"exception":${JSON.stringify(inBandExceptionMessage)}}`,
      `{"exception":"boom","n":1}`,
      `{"n":1,"exception":"boom"}`,
    ]) {
      expect(extractInBandExceptionFromRow(row)).toBeUndefined();
    }
  });

  it("should not treat other rows as an error", async () => {
    for (const row of [
      `{"n":1}`,
      `{"exception": "boom", "n": 1}`,
      `{"exception": "unterminated"`,
      `{"exception": "not a valid" JSON"}`,
      ``,
    ]) {
      expect(extractInBandExceptionFromRow(row)).toBeUndefined();
    }
  });

  it("should only be enabled for the object-per-row formats", async () => {
    expect(canHaveInBandExceptionRow("JSONEachRow")).toBe(true);
    expect(canHaveInBandExceptionRow("JSONStringsEachRow")).toBe(true);
    expect(canHaveInBandExceptionRow("JSONEachRowWithProgress")).toBe(false);
    expect(canHaveInBandExceptionRow("JSONCompactEachRow")).toBe(false);
    expect(canHaveInBandExceptionRow("CSV")).toBe(false);
  });
});

/**
 * \r\n__exception__\r\nFOOBAR
 * boom
 * 5 FOOBAR\r\n__exception__\r\n
 */
export function buildValidErrorChunk(errMsg: string, tag: string): Uint8Array {
  const chunkStr =
    "body-body-body-body\r\n__exception__\r\n" +
    tag +
    "\n" +
    errMsg +
    "\n" +
    (errMsg.length + 1) + // +1 to len for the newline character
    " " +
    tag +
    "\r\n__exception__\r\n";
  return new TextEncoder().encode(chunkStr);
}
