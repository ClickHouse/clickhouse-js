import { describe, it, expect } from "vitest";
import { ClickHouseError } from "@clickhouse/client-common";
import { Readable } from "stream";
import { ResultSet } from "../../src";

// See https://github.com/ClickHouse/clickhouse-js/issues/1084
describe("[Node.js] ResultSet.stream() with an exception block split across chunks", () => {
  const tag = "abcdefghijklmnop"; // the server sends a random 16-character tag
  const errMessage =
    "Code: 395. DB::Exception: Value passed to 'throwIf' function is non-zero: " +
    "while executing 'FUNCTION throwIf(equals(number, 2) :: 1) -> throwIf(equals(number, 2))'. " +
    "(FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 26.3.1.1)";
  const rowsText = '{"number":"0"}\n{"number":"1"}\n';
  // the exact framing the server writes, see WriteBufferFromHTTPServerResponse.cpp
  const exceptionBlock =
    "\r\n__exception__\r\n" +
    tag +
    "\r\n" +
    errMessage +
    "\n" +
    (errMessage.length + 1) +
    " " +
    tag +
    "\r\n__exception__\r\n";
  const body = Buffer.from(rowsText + exceptionBlock);
  const blockStart = rowsText.length;

  it("should parse the error with the block in a single chunk", async () => {
    const err = await getError([body]);
    assertError(err);
  });

  it("should parse the error when the body is split in two at any offset", async () => {
    for (let cut = 1; cut < body.length; cut++) {
      const err = await getError([body.subarray(0, cut), body.subarray(cut)]);
      assertError(err, `cut at ${cut} (block offset ${cut - blockStart})`);
    }
  });

  it("should parse the error when every byte is a separate chunk", async () => {
    const chunks = Array.from(body, (byte) => Buffer.from([byte]));
    const err = await getError(chunks);
    assertError(err);
  });

  it("should fail with an error if the response ends in the middle of the block", async () => {
    // from the opening `\r\n` onwards
    for (let end = blockStart + 2; end < body.length; end++) {
      const truncated = body.subarray(0, end);
      for (const chunks of [
        [truncated],
        [
          truncated.subarray(0, blockStart + 1),
          truncated.subarray(blockStart + 1),
        ],
      ]) {
        const err = await getError(chunks);
        const label = `ends at block offset ${end - blockStart}`;
        expect(err, label).toBeInstanceOf(Error);
        expect(err, label).not.toBeInstanceOf(ClickHouseError);
        expect(err!.message, label).toContain("error in the stream");
      }
    }
  });

  async function getError(chunks: Buffer[]): Promise<Error | undefined> {
    const rs = ResultSet.instance({
      stream: Readable.from(chunks),
      format: "JSONEachRow",
      query_id: "test-query-id",
      log_error: () => {
        //
      },
      response_headers: { "x-clickhouse-exception-tag": tag },
    });
    try {
      // goes through ResultSet.stream()
      await rs.json();
    } catch (err) {
      return err as Error;
    }
    return undefined;
  }

  function assertError(err: Error | undefined, label = "") {
    expect(err, label).toBeInstanceOf(ClickHouseError);
    const chErr = err as ClickHouseError;
    expect(chErr.code, label).toBe("395");
    expect(chErr.type, label).toBe("FUNCTION_THROW_IF_VALUE_IS_NON_ZERO");
    expect(chErr.message, label).toContain(
      "Value passed to 'throwIf' function is non-zero",
    );
  }
});
