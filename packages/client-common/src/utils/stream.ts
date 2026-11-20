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

/**
 * The exact bytes ClickHouse writes at the start of an in-band exception row
 * for the `JSONEachRow` and `JSONStringsEachRow` formats when
 * `http_write_exception_in_output_format` is enabled (the default on servers
 * older than 25.11). The server's exception writer (`JSONUtils::writeException`)
 * puts a space after the colon, while regular data rows of these formats are
 * written without one (`{"exception":...}`), so a genuine result column named
 * `exception` never produces this prefix.
 */
const IN_BAND_EXCEPTION_ROW_PREFIX = '{"exception": "';
const IN_BAND_EXCEPTION_ROW_SUFFIX = '"}';

/**
 * Whether the server may write a mid-stream exception as an in-band row
 * (see {@link extractInBandExceptionFromRow}) for the given format.
 *
 * Only the object-per-row formats are covered: the `JSONCompact*EachRow*`
 * formats write the exception as `["<message>"]`, which cannot be told apart
 * from a single-column `String` row, and `JSONEachRowWithProgress` exposes
 * the exception row to the caller on purpose (see `isException`).
 */
export function canHaveInBandExceptionRow(format: unknown): boolean {
  return format === "JSONEachRow" || format === "JSONStringsEachRow";
}

/**
 * With `http_write_exception_in_output_format` enabled, ClickHouse reports an
 * error that happens after the response has started streaming by writing one
 * more row, `{"exception": "Code: ... DB::Exception: ..."}`, and then ending
 * the body normally. Returns the parsed error if the row is such an
 * exception row, or `undefined` otherwise.
 *
 * @param row a single row of a `JSONEachRow` or `JSONStringsEachRow`
 *  response body, without the trailing newline.
 */
export function extractInBandExceptionFromRow(row: string): Error | undefined {
  if (
    !row.startsWith(IN_BAND_EXCEPTION_ROW_PREFIX) ||
    !row.endsWith(IN_BAND_EXCEPTION_ROW_SUFFIX)
  ) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row);
  } catch {
    return undefined;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Object.keys(parsed).length !== 1 ||
    typeof (parsed as { exception?: unknown }).exception !== "string"
  ) {
    return undefined;
  }
  return parseError((parsed as { exception: string }).exception);
}
