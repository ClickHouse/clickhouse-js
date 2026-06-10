import { Buffer } from 'buffer'
import type { TransformCallback } from 'stream'
import { Transform } from 'stream'

/**
 * Parser for ClickHouse's in-band HTTP exception block.
 *
 * When an error happens after the HTTP 200 status and headers have already been
 * sent, ClickHouse cannot change the status code, so (with the default
 * `http_write_exception_in_output_format=0`) it appends a format-agnostic block
 * to the end of the response body:
 *
 *   \r\n
 *   __exception__\r\n
 *   <TAG>\r\n
 *   <error message>\r\n
 *   <message_length> <TAG>\r\n
 *   __exception__\r\n
 *
 * `<TAG>` is a 16-byte random tag, also sent up front in the
 * `X-ClickHouse-Exception-Tag` response header. The whole block is capped at
 * 16 KiB. Because the message length comes *after* the message and the block is
 * self-delimited by the tag, the robust way to extract it is to retain a 16 KiB
 * sliding tail of the (already decompressed) body and parse it backwards at end
 * of stream. This module does exactly that.
 *
 * NB: the body is expected to already be decompressed by the time it reaches
 * this transformer; the client handles `Content-Encoding` upstream.
 */

const MARKER = Buffer.from('__exception__', 'ascii')
const CRLF = Buffer.from('\r\n', 'ascii')

/** ClickHouse caps the entire in-band exception block at 16 KiB. */
export const DEFAULT_MAX_BLOCK_SIZE = 16 * 1024

export interface ClickHouseExceptionInfo {
  /** Numeric error code parsed from "Code: N." (null if unparseable). */
  code: number | null
  /** Symbolic error name, e.g. FUNCTION_THROW_IF_VALUE_IS_NON_ZERO (null if absent). */
  errorName: string | null
  /** Full decoded error message text. */
  message: string
  /** Raw message bytes exactly as sent by the server. */
  raw: Buffer
}

/** Thrown / surfaced when ClickHouse reported an error mid-stream. */
export class ClickHouseException extends Error {
  readonly code: number | null
  readonly errorName: string | null
  readonly raw: Buffer

  constructor(info: ClickHouseExceptionInfo) {
    super(info.message)
    this.name = 'ClickHouseException'
    this.code = info.code
    this.errorName = info.errorName
    this.raw = info.raw
  }
}

/** Thrown when the stream itself is malformed or truncated mid-exception-block. */
export class ClickHouseStreamError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClickHouseStreamError'
  }
}

export interface ClickHouseExceptionStreamOptions {
  /** Value of the `X-ClickHouse-Exception-Tag` response header. Required. */
  tag: string
  /** Override the retained tail size. Defaults to 16 KiB; do not set below it. */
  maxBlockSize?: number
  /**
   * If true (default), the stream errors with a `ClickHouseException` when an
   * in-band exception is found. If false, the stream ends cleanly and the
   * exception is exposed via `getException()` and the `clickhouse-exception`
   * event instead.
   */
  throwOnException?: boolean
}

/**
 * A Transform that passes ClickHouse result bytes straight through and detects
 * an in-band exception block at the end of the stream.
 *
 * Pipe the *decompressed* response body through it. On success it ends cleanly.
 * On an in-band exception it (by default) errors with a `ClickHouseException`.
 */
export class ClickHouseExceptionStream extends Transform {
  private readonly tag: Buffer
  private readonly maxBlock: number
  private readonly throwOnException: boolean
  /** Opening delimiter, used as a reliable "a real block started" probe: \r\n__exception__\r\n<tag> */
  private readonly openPattern: Buffer
  private buf: Buffer = Buffer.alloc(0)
  private exception: ClickHouseException | null = null

  constructor(opts: ClickHouseExceptionStreamOptions) {
    super()
    if (!opts.tag) {
      throw new TypeError(
        'tag is required (value of the X-ClickHouse-Exception-Tag header)',
      )
    }
    this.tag = Buffer.from(opts.tag, 'ascii')
    this.maxBlock = Math.max(
      opts.maxBlockSize ?? DEFAULT_MAX_BLOCK_SIZE,
      DEFAULT_MAX_BLOCK_SIZE,
    )
    this.throwOnException = opts.throwOnException ?? true
    this.openPattern = Buffer.concat([CRLF, MARKER, CRLF, this.tag])
  }

  /** The parsed exception after the stream ends, or null on success. */
  getException(): ClickHouseException | null {
    return this.exception
  }

  override _transform(
    chunk: Buffer,
    _enc: BufferEncoding,
    cb: TransformCallback,
  ): void {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk])
    // Anything older than the last `maxBlock` bytes cannot be part of a
    // <= maxBlock block sitting at the very end, so release it as confirmed data.
    if (this.buf.length > this.maxBlock) {
      const releaseLen = this.buf.length - this.maxBlock
      const release = this.buf.subarray(0, releaseLen)
      this.buf = this.buf.subarray(releaseLen)
      this.push(release)
    }
    cb()
  }

  override _flush(cb: TransformCallback): void {
    let parsed: {
      exception: ClickHouseException
      dataPrefixEnd: number
    } | null
    try {
      parsed = this.parseTail(this.buf)
    } catch (err) {
      cb(err as Error)
      return
    }

    if (!parsed) {
      // No exception block: the whole retained tail is result data.
      if (this.buf.length > 0) this.push(this.buf)
      cb()
      return
    }

    // Emit any trailing result bytes that preceded the block, then surface the error.
    if (parsed.dataPrefixEnd > 0) {
      this.push(this.buf.subarray(0, parsed.dataPrefixEnd))
    }
    this.exception = parsed.exception
    this.emit('clickhouse-exception', parsed.exception)
    cb(this.throwOnException ? parsed.exception : undefined)
  }

  private parseTail(
    tail: Buffer,
  ): { exception: ClickHouseException; dataPrefixEnd: number } | null {
    const hasOpening = tail.indexOf(this.openPattern) !== -1

    // Helper: a failed structural check is "truncated/malformed" if a real block
    // was started (opening delimiter + matching tag present), otherwise it just
    // means there is no exception and everything is data.
    const bail = (reason: string): null => {
      if (hasOpening) throw new ClickHouseStreamError(reason)
      return null
    }

    // 1. Closing marker must be the last `__exception__`, followed only by an
    //    optional trailing CRLF. (A message containing the literal "__exception__"
    //    is fine: it sits before the meta line, so it is never the last one.)
    const closeIdx = tail.lastIndexOf(MARKER)
    if (closeIdx === -1) {
      return hasOpening
        ? bail(
            'ClickHouse exception block started but never terminated (truncated stream)',
          )
        : null
    }
    const trailing = tail.subarray(closeIdx + MARKER.length)
    if (trailing.length !== 0 && !trailing.equals(CRLF)) {
      return bail(
        'Malformed ClickHouse exception block (unexpected bytes after closing marker)',
      )
    }

    // 2. Closing marker is preceded by CRLF; before that the meta line "<len> <tag>".
    if (closeIdx < 2 || !tail.subarray(closeIdx - 2, closeIdx).equals(CRLF)) {
      return bail(
        'Malformed ClickHouse exception block (missing CRLF before closing marker)',
      )
    }
    const metaEnd = closeIdx - 2
    const crlfBeforeMeta = tail.lastIndexOf(CRLF, metaEnd - 1)
    if (crlfBeforeMeta === -1) {
      return bail('Malformed ClickHouse exception block (no meta line)')
    }

    const metaLine = tail
      .subarray(crlfBeforeMeta + CRLF.length, metaEnd)
      .toString('ascii')
    const sp = metaLine.indexOf(' ')
    if (sp === -1) {
      return bail('Malformed ClickHouse exception block (bad meta line)')
    }
    const lenStr = metaLine.slice(0, sp)
    const tagStr = metaLine.slice(sp + 1)
    if (tagStr !== this.tag.toString('ascii')) {
      // Tag mismatch: this "__exception__" is not ours -> treat as data.
      return null
    }
    if (!/^\d+$/.test(lenStr)) {
      return bail('Malformed ClickHouse exception block (bad message length)')
    }
    const declaredLen = Number(lenStr)

    // 3. The message occupies exactly `declaredLen` bytes ending at the CRLF
    //    before the meta line. Use the length to delimit it unambiguously.
    const messageEnd = crlfBeforeMeta
    const messageStart = messageEnd - declaredLen
    if (messageStart < 0) {
      return bail(
        'Malformed ClickHouse exception block (length exceeds buffer)',
      )
    }
    const raw = tail.subarray(messageStart, messageEnd)

    // 4. Validate the opening framing: <message> is preceded by <tag>\r\n,
    //    which is preceded by \r\n__exception__\r\n.
    const afterOpenTag = messageStart - CRLF.length
    if (
      afterOpenTag < 0 ||
      !tail.subarray(afterOpenTag, messageStart).equals(CRLF)
    ) {
      return bail(
        'Malformed ClickHouse exception block (missing CRLF after opening tag)',
      )
    }
    const openTagStart = afterOpenTag - this.tag.length
    if (
      openTagStart < 0 ||
      !tail.subarray(openTagStart, afterOpenTag).equals(this.tag)
    ) {
      return bail('Malformed ClickHouse exception block (opening tag mismatch)')
    }
    const afterMarker = openTagStart - CRLF.length
    if (
      afterMarker < 0 ||
      !tail.subarray(afterMarker, openTagStart).equals(CRLF)
    ) {
      return bail(
        'Malformed ClickHouse exception block (missing CRLF after opening marker)',
      )
    }
    const markerStart = afterMarker - MARKER.length
    if (
      markerStart < 0 ||
      !tail.subarray(markerStart, afterMarker).equals(MARKER)
    ) {
      return bail(
        'Malformed ClickHouse exception block (missing opening marker)',
      )
    }

    // The block's injected leading CRLF (if present) is a separator, not data.
    let dataPrefixEnd = markerStart
    if (
      markerStart >= CRLF.length &&
      tail.subarray(markerStart - CRLF.length, markerStart).equals(CRLF)
    ) {
      dataPrefixEnd = markerStart - CRLF.length
    }

    return { exception: toException(raw), dataPrefixEnd }
  }
}

function toException(raw: Buffer): ClickHouseException {
  const message = raw.toString('utf8')
  const codeMatch = /^Code:\s*(\d+)\./.exec(message)
  const nameMatch = /\(([A-Z][A-Z0-9_]+)\)/.exec(message)
  return new ClickHouseException({
    code: codeMatch ? Number(codeMatch[1]) : null,
    errorName: nameMatch ? nameMatch[1] : null,
    message,
    raw,
  })
}
