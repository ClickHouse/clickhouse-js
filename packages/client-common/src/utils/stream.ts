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
