import { describe, it, expect } from "vitest";
import {
  ClickHouseError,
  ExceptionBlockBuffer,
  extractErrorAtTheEndOfChunk,
} from "../../src/index";

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

  it("should not hang on a chunk with no newline before the length hint", async () => {
    // exactly long enough to pass the length check, but without the message
    const chunk = new TextEncoder().encode(
      "\r\n__exception__\r\n" + tag + "\r\n",
    );

    const err = extractErrorAtTheEndOfChunk(chunk, tag);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("error in the stream");
  });

  describe("ExceptionBlockBuffer", () => {
    const chMessage =
      "Code: 395. DB::Exception: Value passed to 'throwIf' function is non-zero. " +
      "(FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 26.3.1.1)";
    const encoder = new TextEncoder();
    const block = buildValidErrorChunk(chMessage, tag).subarray(
      "body-body-body-body".length,
    );

    it("should parse a complete block pushed at once", async () => {
      const err = new ExceptionBlockBuffer(tag).push(block);
      expect(err).toBeInstanceOf(ClickHouseError);
      expect((err as ClickHouseError).code).toBe("395");
      expect((err as ClickHouseError).type).toBe(
        "FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
      );
    });

    it("should wait for the closing marker when the block is pushed byte by byte", async () => {
      const buffer = new ExceptionBlockBuffer(tag);
      for (let i = 0; i < block.length - 1; i++) {
        expect(buffer.push(block.subarray(i, i + 1)), `byte ${i}`).toBe(
          undefined,
        );
      }
      const err = buffer.push(block.subarray(block.length - 1));
      expect(err).toBeInstanceOf(ClickHouseError);
      expect((err as ClickHouseError).code).toBe("395");
    });

    it("should fail right away if the bytes do not start with the opening marker", async () => {
      const buffer = new ExceptionBlockBuffer(tag);
      expect(buffer.push(encoder.encode("\r\n__exc"))).toBe(undefined);
      const err = buffer.push(encoder.encode("ept1on__\r\n"));
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(ClickHouseError);
      expect(err!.message).toContain("error in the stream");
    });

    it("should fail with a tag other than the expected one", async () => {
      const err = new ExceptionBlockBuffer("OTHERTAG").push(block);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(ClickHouseError);
    });

    it("should not buffer more than the server's exception block size limit", async () => {
      const buffer = new ExceptionBlockBuffer(tag);
      expect(
        buffer.push(encoder.encode("\r\n__exception__\r\n" + tag + "\r\n")),
      ).toBe(undefined);
      const err = buffer.push(new Uint8Array(16 * 1024));
      expect(err).toBeInstanceOf(Error);
      expect(err!.message).toContain("error in the stream");
    });
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
