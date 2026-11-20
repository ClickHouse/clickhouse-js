import { ClickHouseError, parseError } from "../error";

const EXCEPTION_MARKER = "__exception__";

const NEWLINE = 0x0a as const;
export const CARET_RETURN = 0x0d as const;

/** Detects an in-band error after data rows in the object-per-row JSON formats.
 *  A result with only an `exception` column is ambiguous, so keep it as data.
 *  Compact formats have the same ambiguity with any single String column. */
export function createJSONEachRowErrorDetector(
  format: unknown,
): ((text: string) => ClickHouseError | undefined) | undefined {
  if (format !== "JSONEachRow" && format !== "JSONStringsEachRow") {
    return undefined;
  }

  let firstRow = true;
  let exceptionColumn = false;
  return (text) => {
    if (exceptionColumn) return undefined;
    const isFirstRow = firstRow;
    firstRow = false;
    // Keep ordinary rows lazy: only parse a possible exception row here.
    if (!/^\s*\{\s*"exception"\s*:/.test(text)) return undefined;

    let row: { exception?: unknown };
    try {
      row = JSON.parse(text);
    } catch {
      // Leave JSON parse errors to Row.json(), as for ordinary rows.
      return undefined;
    }
    if (Object.keys(row).length !== 1) return undefined;
    if (isFirstRow) {
      exceptionColumn = true;
      return undefined;
    }
    if (typeof row.exception !== "string") return undefined;
    const error = parseError(row.exception);
    return error instanceof ClickHouseError ? error : undefined;
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
