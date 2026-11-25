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
 * @internal
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
 *
 * To continue a `"partial"` result with the next chunk, set `matchedLength` to
 * the number of bytes after the `\n` that matched before, and `offset` to `0`.
 * @internal
 */
export function matchExceptionBlockStart(
  bytes: Uint8Array,
  offset: number,
  exceptionTag: string,
  matchedLength = 0,
): ExceptionBlockStartMatch {
  // Same reasoning as in endsWithExceptionMarker: the tag is the discriminator.
  if (exceptionTag.length === 0) {
    return "none";
  }
  // Layout after the opening `\r\n`: __exception__ \r \n <exceptionTag>
  const expectedLength = EXCEPTION_MARKER.length + 2 + exceptionTag.length;
  const available = Math.min(
    matchedLength + bytes.length - offset,
    expectedLength,
  );
  for (let i = matchedLength; i < available; i++) {
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
    if (bytes[offset + i - matchedLength] !== expected) {
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
 * @internal
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

const NO_BYTES = new Uint8Array(0);

/** A copy of `bytes` from `start` that does not share memory with `bytes`. */
function copyBytes(bytes: Uint8Array, start: number) {
  const copy = new Uint8Array(bytes.length - start);
  copy.set(bytes.subarray(start));
  return copy;
}

function joinBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

/** See {@link BinaryExceptionScanner}. */
export interface BinaryScanResult {
  /** The bytes that the consumer can have. Can be empty. */
  data: Uint8Array;
  /** The server error, or an error about a malformed or incomplete block. */
  error?: Error;
}

/**
 * Finds a mid-stream exception block (ClickHouse 25.11+) in a stream of bytes
 * of any format, for example Parquet, and gives all the other bytes unchanged.
 *
 * The block opens with `\r\n__exception__\r\n<exceptionTag>`, where
 * `exceptionTag` is the random per-response token of the
 * `x-clickhouse-exception-tag` header, so a `\r\n` in binary data is not taken
 * for a block. The server closes the connection right after the block, so the
 * error is given as soon as the block is complete, and not at the end of the
 * stream.
 *
 * The bytes that the scanner keeps between two chunks (a possible start of
 * the block, or the block) are copies. The consumer can change or transfer the
 * buffers of the chunks that it gets.
 * @internal
 */
export class BinaryExceptionScanner {
  /** The last bytes of the stream, if they can start a block opening: a
   *  `\r`, or a `\r\n` and the start of `__exception__\r\n<exceptionTag>`. */
  private held: Uint8Array = NO_BYTES;
  /** The block from after its opening `\r\n`, once it has started. */
  private block: Uint8Array | undefined;
  private failed = false;
  private readonly exceptionTag: string;

  /** `exceptionTag` must not be empty. */
  constructor(exceptionTag: string) {
    this.exceptionTag = exceptionTag;
  }

  /** Scans the next chunk of the response. */
  push(chunk: Uint8Array): BinaryScanResult {
    if (this.failed) {
      return { data: NO_BYTES };
    }
    if (this.block !== undefined) {
      this.block = joinBytes(this.block, chunk);
      return this.blockResult(NO_BYTES);
    }
    // The held bytes go in front of the chunk. This copies the chunk, but only
    // when the previous chunk ended with a `\r` or a cut block opening.
    const bytes = this.held.length > 0 ? joinBytes(this.held, chunk) : chunk;
    this.held = NO_BYTES;
    return this.blockResult(this.scan(bytes));
  }

  /**
   * Ends the scan, when the response ends or the response stream fails (for
   * example, the connection was closed). If the block started, the error is
   * the server error, when the block is complete, or an error about an
   * incomplete block. Otherwise the caller gives the source error, if any.
   */
  end(): BinaryScanResult {
    if (this.failed) {
      return { data: NO_BYTES };
    }
    if (this.block !== undefined) {
      this.failed = true;
      return {
        data: NO_BYTES,
        error: errorFromExceptionBlock(this.block, this.exceptionTag, true),
      };
    }
    // A `\r` or a cut block opening at the end. Without the tag, these bytes
    // cannot be told from data, so they are data, also before a source error.
    const data = this.held;
    this.held = NO_BYTES;
    return { data };
  }

  /** The bytes of `chunk` up to a block opening or a possible one, if any.
   *  The rest is kept in {@link held} or {@link block}. */
  private scan(chunk: Uint8Array): Uint8Array {
    let from = 0;
    while (true) {
      const idx = chunk.indexOf(NEWLINE, from);
      if (idx === -1) {
        break;
      }
      from = idx + 1;
      // A `\n` at index 0 is not after a `\r`: a `\r` at the end of the
      // previous chunk is held, and it is in front of this chunk.
      if (idx === 0 || chunk[idx - 1] !== CARET_RETURN) {
        continue;
      }
      const match = matchExceptionBlockStart(chunk, idx + 1, this.exceptionTag);
      if (match === "none") {
        continue;
      }
      if (match === "partial") {
        this.held = copyBytes(chunk, idx - 1);
      } else {
        this.block = copyBytes(chunk, idx + 1);
      }
      return chunk.subarray(0, idx - 1);
    }
    if (chunk.length > 0 && chunk[chunk.length - 1] === CARET_RETURN) {
      this.held = copyBytes(chunk, chunk.length - 1);
      return chunk.subarray(0, chunk.length - 1);
    }
    return chunk;
  }

  private blockResult(data: Uint8Array): BinaryScanResult {
    if (this.block === undefined) {
      return { data };
    }
    const error = errorFromExceptionBlock(this.block, this.exceptionTag);
    if (error !== undefined) {
      this.failed = true;
    }
    return { data, error };
  }
}
