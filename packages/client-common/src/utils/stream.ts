import { parseError } from '../error'

const EXCEPTION_MARKER = '__exception__'

const NEWLINE = 0x0a as const
export const CARET_RETURN = 0x0d as const

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
      2 // \r\n

    let errMsgLenStartIdx = chunk.length - bytesCountAfterErrLenHint
    if (errMsgLenStartIdx < 1) {
      return new Error(
        'there was an error in the stream, but the last chunk is malformed',
      )
    }

    do {
      --errMsgLenStartIdx
    } while (chunk[errMsgLenStartIdx] !== NEWLINE)

    const textDecoder = new TextDecoder('utf-8')

    const errMsgLen = parseInt(
      textDecoder.decode(
        chunk.subarray(errMsgLenStartIdx, -bytesCountAfterErrLenHint),
      ),
    )

    if (isNaN(errMsgLen) || errMsgLen <= 0) {
      return new Error(
        'there was an error in the stream; failed to parse the message length',
      )
    }

    const errMsg = textDecoder.decode(
      chunk.subarray(
        errMsgLenStartIdx - errMsgLen + 1, // skipping the newline character
        errMsgLenStartIdx,
      ),
    )

    return parseError(errMsg)
  } catch (err) {
    // theoretically, it can happen if a proxy cuts the last chunk
    return err as Error
  }
}
