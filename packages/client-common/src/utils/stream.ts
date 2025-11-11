import { parseError } from '../error'

/**
 * New in 25.11.
 * See https://github.com/ClickHouse/ClickHouse/pull/88818
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

const EXCEPTION_MARKER = '__exception__'

const NEWLINE = 0x0a as const
const CARET_RETURN = 0x0d as const

export function checkErrorInChunkAtIndex(
  chunk: Uint8Array,
  idx: number,
  exceptionMarker: string | undefined,
): Error | undefined {
  if (
    idx > 0 &&
    chunk[idx - 1] === CARET_RETURN &&
    exceptionMarker !== undefined
  ) {
    return tryHandleStreamError(exceptionMarker, chunk)
  }
}

function tryHandleStreamError(
  exceptionMarker: string,
  chunk: Uint8Array,
): Error {
  try {
    const bytesAfterExceptionLength =
      1 + // space
      EXCEPTION_MARKER.length + // __exception__
      2 + // \r\n
      exceptionMarker.length + // <marker>
      2 // \r\n

    let lenStartIdx = chunk.length - bytesAfterExceptionLength
    do {
      --lenStartIdx
    } while (chunk[lenStartIdx] !== NEWLINE)

    const exceptionLen = +chunk
      .subarray(lenStartIdx, -bytesAfterExceptionLength)
      .toString()

    const exceptionMessage = chunk
      .subarray(lenStartIdx - exceptionLen, lenStartIdx)
      .toString()

    return parseError(exceptionMessage)
  } catch (err) {
    // theoretically, it can happen if a proxy cuts the last chunk
    return err as Error
  }
}
