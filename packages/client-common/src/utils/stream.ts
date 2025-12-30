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
  /**
   * Expected to be 16 ASKII characters long
   *
   * @see https://clickhouse.com/docs/interfaces/http#:~:text=TAG%3E%20is%20a-,16%20byte%20random%20tag,-%2C%20which%20is%20the
   */
  exceptionTag: string,
): Error | null {
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
    } while (errMsgLenStartIdx > 0 && chunk[errMsgLenStartIdx] !== NEWLINE)

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

/**
 * Optimistic version of `extractErrorAtTheEndOfChunk` that assumes
 */
export function extractErrorAtTheEndOfChunkStrict(
  chunk: Uint8Array,
  /**
   * Expected to be 16 ASKII characters long
   *
   * @see https://clickhouse.com/docs/interfaces/http#:~:text=TAG%3E%20is%20a-,16%20byte%20random%20tag,-%2C%20which%20is%20the
   */
  exceptionTag: string,
): Error | null {
  try {
    const bytesCountAfterErrLenHint =
      1 + // space
      EXCEPTION_MARKER.length + // __exception__
      2 + // \r\n
      exceptionTag.length + // <value taken from the header>
      2 // \r\n

    let errMsgLenStartIdx = chunk.length - bytesCountAfterErrLenHint
    if (errMsgLenStartIdx < 1) {
      // not enough data to even contain the error length hint
      return null
    }

    do {
      --errMsgLenStartIdx
    } while (errMsgLenStartIdx > 0 && chunk[errMsgLenStartIdx] !== NEWLINE)

    const textDecoder = new TextDecoder('utf-8')

    const errMsgLen = parseInt(
      textDecoder.decode(
        chunk.subarray(errMsgLenStartIdx, -bytesCountAfterErrLenHint),
      ),
    )

    if (isNaN(errMsgLen) || errMsgLen <= 0) {
      // does not look like an error length hint
      return null
    }

    const closingTag = textDecoder.decode(
      chunk.subarray(
        -bytesCountAfterErrLenHint + 1, // skipping the space character
        -bytesCountAfterErrLenHint + exceptionTag.length,
      ),
    )

    if (closingTag !== exceptionTag) {
      // the tag does not match; this is not an error chunk
      return null
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
