import { parseError } from "../error";

const EXCEPTION_MARKER = "__exception__";

const NEWLINE = 0x0a as const;
export const CARET_RETURN = 0x0d as const;

/**
 * After 25.11, a newline error character is preceded by a caret return
 * this is a strong indication that we have an exception in the stream.
 *
 * Example with exception marker `FOOBAR`:
 *
 * \r\n__exception__\r\nFOOBAR
 * boom
 * 5 FOOBAR\r\n__exception__\r\n
 *
 * In this case, the exception length is 5 (including the newline character),
 * and the exception message is "boom".
 */
export function extractErrorAtTheEndOfChunk(
  chunk: Uint8Array,
  exceptionTag: string,
): Error {
  try {
    const bytesCountAfterErrLenHint =
      1 + // space
      EXCEPTION_MARKER.length + // __exception__
      2 + // \r\n
      exceptionTag.length + // <value taken from the header>
      2; // \r\n

    let errMsgLenStartIdx = chunk.length - bytesCountAfterErrLenHint;
    if (errMsgLenStartIdx < 1) {
      return new Error(
        "there was an error in the stream, but the last chunk is malformed",
      );
    }

    // Scan backwards for the newline that delimits the error-length hint.
    // The scan is floored at the start of the chunk: a malformed trailer (e.g.
    // truncated by a proxy, with no newline below the hint) must not send the
    // index negative and spin forever, which would block the event loop since
    // `chunk[-1]` is `undefined` (never a newline) and nothing throws.
    do {
      --errMsgLenStartIdx;
    } while (errMsgLenStartIdx >= 0 && chunk[errMsgLenStartIdx] !== NEWLINE);
    if (errMsgLenStartIdx < 0) {
      return new Error(
        "there was an error in the stream, but the last chunk is malformed",
      );
    }

    const textDecoder = new TextDecoder("utf-8");

    const errMsgLen = parseInt(
      textDecoder.decode(
        chunk.subarray(errMsgLenStartIdx, -bytesCountAfterErrLenHint),
      ),
    );

    if (isNaN(errMsgLen) || errMsgLen <= 0) {
      return new Error(
        "there was an error in the stream; failed to parse the message length",
      );
    }

    const errMsg = textDecoder.decode(
      chunk.subarray(
        errMsgLenStartIdx - errMsgLen + 1, // skipping the newline character
        errMsgLenStartIdx,
      ),
    );

    return parseError(errMsg);
  } catch (err) {
    // theoretically, it can happen if a proxy cuts the last chunk
    return err as Error;
  }
}

/**
 * Sound discriminator for the mid-stream exception trailer.
 *
 * When an error occurs after ClickHouse (25.11+) has already started streaming
 * a 200 response, it terminates the body with the exact byte sequence
 * `<exceptionTag>\r\n__exception__\r\n`, where `exceptionTag` is the random
 * per-response token echoed by the `x-clickhouse-exception-tag` response header.
 * Returns `true` only when `chunk` ends with that sequence.
 *
 * Requiring both the fixed `__exception__` marker *and* the random per-response
 * tag makes detection reliable, so a bare `\r\n` occurring inside a *successful*
 * response body — binary formats such as Parquet, or CRLF-terminated CSV/TSV
 * rows (`output_format_*_crlf_end_of_line`) — is not mistaken for an exception.
 */
export function endsWithExceptionMarker(
  chunk: Uint8Array,
  exceptionTag: string,
): boolean {
  // The random per-response tag is the discriminator; without it the check
  // cannot be sound. Refuse to treat the chunk as an exception rather than
  // fall back to a marker-only match (better to miss a degenerate tag-less
  // trailer than to abort a successful stream on a stray `__exception__`).
  if (exceptionTag.length === 0) {
    return false;
  }
  // Suffix layout, from `chunk.length` backwards:
  //   <exceptionTag> \r \n __exception__ \r \n
  const suffixLength = exceptionTag.length + 2 + EXCEPTION_MARKER.length + 2;
  if (chunk.length < suffixLength) {
    return false;
  }
  let pos = chunk.length - suffixLength;
  for (let i = 0; i < exceptionTag.length; i++) {
    if (chunk[pos++] !== exceptionTag.charCodeAt(i)) {
      return false;
    }
  }
  if (chunk[pos++] !== CARET_RETURN || chunk[pos++] !== NEWLINE) {
    return false;
  }
  for (let i = 0; i < EXCEPTION_MARKER.length; i++) {
    if (chunk[pos++] !== EXCEPTION_MARKER.charCodeAt(i)) {
      return false;
    }
  }
  return chunk[pos++] === CARET_RETURN && chunk[pos] === NEWLINE;
}

/** ClickHouse caps the whole mid-stream exception block at 16 KiB. */
const MAX_EXCEPTION_BLOCK_SIZE = 16 * 1024;

/** See {@link matchExceptionBlockStart}. */
export type ExceptionBlockStartMatch = "match" | "partial" | "none";

/**
 * A mid-stream exception block (ClickHouse 25.11+) opens with
 * `\r\n__exception__\r\n<exceptionTag>`, where `exceptionTag` is the random
 * per-response token echoed by the `x-clickhouse-exception-tag` header.
 *
 * Call this for a `\n` that is preceded by `\r`, with `offset` set to the index
 * right after that `\n`. Returns:
 * - `"match"` when the bytes from `offset` complete the block opening;
 * - `"partial"` when the bytes from `offset` are an incomplete prefix of it,
 *   so that the next chunk is necessary to decide;
 * - `"none"` otherwise (e.g. a CRLF-terminated CSV/TSV row, or binary data).
 */
export function matchExceptionBlockStart(
  bytes: Uint8Array,
  offset: number,
  exceptionTag: string,
): ExceptionBlockStartMatch {
  // Same reasoning as in endsWithExceptionMarker: the tag is the discriminator.
  if (exceptionTag.length === 0) {
    return "none";
  }
  // Layout after the opening `\r\n`: __exception__ \r \n <exceptionTag>
  const expectedLength = EXCEPTION_MARKER.length + 2 + exceptionTag.length;
  const available = Math.min(bytes.length - offset, expectedLength);
  for (let i = 0; i < available; i++) {
    let expected: number;
    if (i < EXCEPTION_MARKER.length) {
      expected = EXCEPTION_MARKER.charCodeAt(i);
    } else if (i === EXCEPTION_MARKER.length) {
      expected = CARET_RETURN;
    } else if (i === EXCEPTION_MARKER.length + 1) {
      expected = NEWLINE;
    } else {
      expected = exceptionTag.charCodeAt(i - EXCEPTION_MARKER.length - 2);
    }
    if (bytes[offset + i] !== expected) {
      return "none";
    }
  }
  return available === expectedLength ? "match" : "partial";
}

/**
 * Parses a mid-stream exception block, which can arrive split across several
 * chunks. `block` holds the bytes of the block received so far, from its
 * opening (see {@link matchExceptionBlockStart}) onwards.
 *
 * Returns the server error once the block is complete, i.e. when it ends with
 * `<exceptionTag>\r\n__exception__\r\n`. Returns `undefined` while more bytes
 * are necessary, unless `isEndOfStream` is set (the response ended before the
 * block was complete) or the block exceeds the 16 KiB that ClickHouse allows;
 * then it returns an error that tells that the block is incomplete or malformed.
 */
export function errorFromExceptionBlock(
  block: Uint8Array,
  exceptionTag: string,
  isEndOfStream = false,
): Error | undefined {
  if (endsWithExceptionMarker(block, exceptionTag)) {
    return extractErrorAtTheEndOfChunk(block, exceptionTag);
  }
  if (isEndOfStream) {
    return new Error(
      "there was an error in the stream, but the exception block is incomplete",
    );
  }
  if (block.length > MAX_EXCEPTION_BLOCK_SIZE) {
    return new Error(
      "there was an error in the stream, but the exception block is malformed",
    );
  }
  return undefined;
}
