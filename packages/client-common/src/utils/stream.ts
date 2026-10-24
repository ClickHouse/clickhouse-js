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

/** Mirrors `MAX_EXCEPTION_SIZE` on the server: the whole exception block
 *  (markers, tags, length and message) never exceeds 16 KiB. */
const MAX_EXCEPTION_BLOCK_SIZE = 16 * 1024;

/**
 * Collects a tagged exception block (see {@link extractErrorAtTheEndOfChunk})
 * that may be split across several stream chunks, and parses it only once
 * the closing `<tag>\r\n__exception__\r\n` marker has arrived.
 *
 * Feed it everything starting at the `\r` of the opening `\r\n`.
 * {@link push} returns `undefined` while more bytes are needed, and an error
 * as soon as the block is complete, or once it is clear that the bytes are
 * not a valid exception block (the opening marker does not match, or the
 * block exceeds the server's size limit). If the stream ends before that,
 * {@link end} returns the error to fail the stream with.
 *
 * @internal
 */
export class ExceptionBlockBuffer {
  private readonly exceptionTag: string;
  private readonly opening: Uint8Array;
  private readonly closing: Uint8Array;
  private buffer = new Uint8Array(0);

  constructor(exceptionTag: string) {
    this.exceptionTag = exceptionTag;
    const encoder = new TextEncoder();
    this.opening = encoder.encode(
      "\r\n" + EXCEPTION_MARKER + "\r\n" + exceptionTag,
    );
    this.closing = encoder.encode(
      exceptionTag + "\r\n" + EXCEPTION_MARKER + "\r\n",
    );
  }

  push(bytes: Uint8Array): Error | undefined {
    const prevLength = this.buffer.length;
    const buffer = new Uint8Array(prevLength + bytes.length);
    buffer.set(this.buffer, 0);
    buffer.set(bytes, prevLength);
    this.buffer = buffer;

    const openingBytesToCheck = Math.min(buffer.length, this.opening.length);
    for (let i = prevLength; i < openingBytesToCheck; i++) {
      if (buffer[i] !== this.opening[i]) {
        // not the exception block we are waiting for
        return this.end();
      }
    }
    if (buffer.length < this.opening.length) {
      return undefined;
    }

    // the closing marker cannot overlap with the opening one, and it was not
    // in the bytes received before, so only its possible new positions are checked
    const searchFrom = Math.max(
      this.opening.length,
      prevLength - this.closing.length + 1,
    );
    const closingIdx = indexOfBytes(buffer, this.closing, searchFrom);
    if (closingIdx !== -1) {
      return extractErrorAtTheEndOfChunk(
        buffer.subarray(0, closingIdx + this.closing.length),
        this.exceptionTag,
      );
    }
    if (buffer.length > MAX_EXCEPTION_BLOCK_SIZE) {
      return this.end();
    }
    return undefined;
  }

  /** The stream ended before the closing marker arrived, or the bytes are
   *  not a valid exception block. The bytes are not parsed in this case:
   *  they are either an incomplete block or row data. */
  end(): Error {
    return new Error(
      "there was an error in the stream, but the exception block is malformed or incomplete",
    );
  }
}

function indexOfBytes(
  haystack: Uint8Array,
  needle: Uint8Array,
  fromIndex: number,
): number {
  const last = haystack.length - needle.length;
  outer: for (let i = fromIndex; i <= last; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}
