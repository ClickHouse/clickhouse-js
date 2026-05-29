import { parseError } from '../error'

const EXCEPTION_MARKER = '__exception__'

const NEWLINE = 0x0a as const
export const CARET_RETURN = 0x0d as const

/** The literal prefix that precedes a mid-stream exception block (after 25.11).
 *  The full start marker is this prefix followed by the exception tag value
 *  taken from the {@link EXCEPTION_TAG_HEADER_NAME} response header. */
const EXCEPTION_START_PREFIX = `\r\n${EXCEPTION_MARKER}\r\n`

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

const EMPTY_BYTES = new Uint8Array(0)

function indexOfSubarray(
  haystack: Uint8Array,
  needle: Uint8Array,
  fromIndex = 0,
): number {
  if (needle.length === 0) return -1
  outer: for (let i = fromIndex; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        continue outer
      }
    }
    return i
  }
  return -1
}

function concatBytes(chunks: Uint8Array[], totalLength: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

/**
 * The result of feeding a chunk to {@link RawStreamExceptionDetector}:
 * `data` is the slice of raw bytes that is safe to emit downstream,
 * and `error`, when present, is a parsed mid-stream exception that terminates
 * the stream.
 */
export interface RawStreamChunkResult {
  data: Uint8Array
  error?: Error
}

/**
 * A stateful helper that lets raw (binary) streams - such as Parquet - be
 * forwarded byte-for-byte while still detecting and parsing a mid-stream
 * exception that the server may append at the very end of the response.
 *
 * Unlike the row-oriented {@link extractErrorAtTheEndOfChunk} heuristic (which
 * keys off a bare `\r\n` and therefore yields false positives on binary data),
 * this detector matches the full exception start marker
 * `\r\n__exception__\r\n<tag>`, where `<tag>` is the random value taken from the
 * {@link EXCEPTION_TAG_HEADER_NAME} response header. This combination is
 * effectively impossible to encounter by chance inside binary payloads.
 */
export class RawStreamExceptionDetector {
  private readonly startMarker: Uint8Array
  /** Bytes withheld from the previous chunk that could be a partial start marker. */
  private pending: Uint8Array = EMPTY_BYTES
  /** Once the start marker is found, all subsequent bytes are accumulated here. */
  private readonly exceptionChunks: Uint8Array[] = []
  private exceptionLength = 0
  private inException = false

  constructor(private readonly exceptionTag: string) {
    this.startMarker = new TextEncoder().encode(
      EXCEPTION_START_PREFIX + exceptionTag,
    )
  }

  /**
   * Feeds the next chunk of the raw stream to the detector.
   * @returns the slice of raw bytes that is safe to emit to the consumer.
   */
  push(chunk: Uint8Array): Uint8Array {
    if (this.inException) {
      this.exceptionChunks.push(chunk)
      this.exceptionLength += chunk.length
      return EMPTY_BYTES
    }

    const buf =
      this.pending.length === 0
        ? chunk
        : concatBytes([this.pending, chunk], this.pending.length + chunk.length)
    this.pending = EMPTY_BYTES

    const markerIdx = indexOfSubarray(buf, this.startMarker)
    if (markerIdx !== -1) {
      this.inException = true
      const exceptionPart = buf.subarray(markerIdx)
      this.exceptionChunks.push(exceptionPart)
      this.exceptionLength += exceptionPart.length
      return buf.subarray(0, markerIdx)
    }

    // No full marker. The tail of the current buffer could still be the
    // beginning of a start marker that completes in the next chunk, so we hold
    // back the last (markerLength - 1) bytes until we can be sure.
    const keep = Math.min(this.startMarker.length - 1, buf.length)
    this.pending = buf.subarray(buf.length - keep)
    return buf.subarray(0, buf.length - keep)
  }

  /**
   * Signals the end of the stream.
   * @returns any remaining bytes to emit as `data`, and a parsed `error` if a
   * mid-stream exception was detected.
   */
  flush(): RawStreamChunkResult {
    if (this.inException) {
      const fullException = concatBytes(
        this.exceptionChunks,
        this.exceptionLength,
      )
      return {
        data: EMPTY_BYTES,
        error: extractErrorAtTheEndOfChunk(fullException, this.exceptionTag),
      }
    }
    const data = this.pending
    this.pending = EMPTY_BYTES
    return { data }
  }
}
