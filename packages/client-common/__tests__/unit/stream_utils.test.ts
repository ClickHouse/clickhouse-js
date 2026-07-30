import { describe, it, expect } from "vitest";
import {
  endsWithExceptionMarker,
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

  // Regression: a malformed trailer whose only newline sits *above* the
  // error-length hint (e.g. a single long CRLF-terminated row, or a trailer
  // truncated by a proxy) used to run the backward scan index below zero and
  // spin forever, blocking the Node.js event loop (nothing throws, so the
  // surrounding try/catch could not rescue it). It must now return a plain
  // Error instead of hanging.
  it("returns an error instead of hanging when there is no length delimiter", () => {
    const chunk = new TextEncoder().encode("x".repeat(100) + "\r\n");

    const err = extractErrorAtTheEndOfChunk(chunk, tag);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("error in the stream");
  }, 5000);
});

describe("utils/stream endsWithExceptionMarker", () => {
  const tag = "abcdefghijklmnop";
  const enc = (s: string) => new TextEncoder().encode(s);

  // A binary payload (e.g. Parquet) that merely happens to end in a \r\n pair.
  const binaryEndingInCRLF = () => {
    const bytes = new Uint8Array(64);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = (i * 7) % 251;
    }
    bytes[62] = 0x0d;
    bytes[63] = 0x0a;
    return bytes;
  };

  const cases: Array<{
    name: string;
    chunk: Uint8Array;
    checkTag: string;
    expected: boolean;
  }> = [
    {
      name: "the exact end-of-stream trailer for the tag",
      chunk: enc(`${tag}\r\n__exception__\r\n`),
      checkTag: tag,
      expected: true,
    },
    {
      name: "a full exception trailer preceded by a body",
      chunk: buildValidErrorChunk("boom", tag),
      checkTag: tag,
      expected: true,
    },
    {
      name: "a successful CRLF-terminated CSV/TSV body",
      chunk: enc("0\r\n1\r\n2\r\n"),
      checkTag: tag,
      expected: false,
    },
    {
      name: "a binary body that merely ends in a \\r\\n pair",
      chunk: binaryEndingInCRLF(),
      checkTag: tag,
      expected: false,
    },
    {
      name: "a chunk shorter than the marker",
      chunk: enc("\r\n"),
      checkTag: tag,
      expected: false,
    },
    {
      name: "the __exception__ marker present but a different tag value",
      chunk: enc(`ponmlkjihgfedcba\r\n__exception__\r\n`),
      checkTag: tag,
      expected: false,
    },
    {
      // Full-length suffix, correct tag, but the two bytes after the tag are
      // not the `\r\n` separator: a near-miss trailer must be rejected.
      name: "the tag matches but the bytes after it are not a CRLF separator",
      chunk: enc(`${tag}XX__exception__\r\n`),
      checkTag: tag,
      expected: false,
    },
    {
      // Correct tag and `\r\n`, but the fixed marker bytes are wrong: without a
      // literal `__exception__` this is not a trailer.
      name: "the tag and CRLF match but the __exception__ marker bytes differ",
      chunk: enc(`${tag}\r\n${"x".repeat("__exception__".length)}\r\n`),
      checkTag: tag,
      expected: false,
    },
    {
      // Everything matches except the terminating newline — the closest
      // possible near-miss to a real trailer must still be rejected.
      name: "a full-length trailer whose terminating newline byte is corrupted",
      chunk: enc(`${tag}\r\n__exception__\rX`),
      checkTag: tag,
      expected: false,
    },
    {
      name: "a trailer exactly one byte too short (missing final newline)",
      chunk: enc(`${tag}\r\n__exception__\r`),
      checkTag: tag,
      expected: false,
    },
    {
      // Guards the implicit non-empty-tag precondition: the tag is the only
      // discriminator, so an empty tag must never match the bare marker.
      name: "an empty tag against a body ending in the bare marker",
      chunk: enc(`garbage\r\n__exception__\r\n`),
      checkTag: "",
      expected: false,
    },
  ];

  for (const { name, chunk, checkTag, expected } of cases) {
    it(`returns ${expected} for ${name}`, () => {
      expect(endsWithExceptionMarker(chunk, checkTag)).toBe(expected);
    });
  }
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
