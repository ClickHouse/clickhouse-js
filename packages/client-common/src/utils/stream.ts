import { parseError } from "../error";

const EXCEPTION_MARKER = "__exception__";

const NEWLINE = 0x0a as const;
export const CARET_RETURN = 0x0d as const;

// Error envelopes have a space after the colon; ordinary JSON rows do not.
// Capture the encoded message, so JSON.parse checks and decodes only a string.
const JSON_EXCEPTION_MESSAGE = /^\{"exception": (".*")\}$/s;

/** Creates an error decoder for the JSON formats that use object rows.
 *  The wire format distinguishes errors from a column named `exception`.
 *  Compact JSON formats do not have that distinction. */
export function createJSONEachRowErrorDetector(
  format: unknown,
): ((text: string) => Error | undefined) | undefined {
  if (format !== "JSONEachRow" && format !== "JSONStringsEachRow") {
    return undefined;
  }

  return (text) => {
    const encodedMessage = JSON_EXCEPTION_MESSAGE.exec(text)?.[1];
    if (encodedMessage === undefined) return undefined;

    let message: string;
    try {
      message = JSON.parse(encodedMessage);
    } catch {
      // A malformed string or extra object fields are not an error envelope.
      return undefined;
    }
    return parseError(message);
  };
}

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

    do {
      --errMsgLenStartIdx;
    } while (chunk[errMsgLenStartIdx] !== NEWLINE);

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
