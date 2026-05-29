import { describe, it, expect } from 'vitest'
import {
  extractErrorAtTheEndOfChunk,
  RawStreamExceptionDetector,
} from '../../src/index'

describe('utils/stream', () => {
  const errMsg = 'boom'
  const tag = 'FOOBAR'

  it('should handle a valid error chunk', async () => {
    const chunk = buildValidErrorChunk(errMsg, tag)

    const err = extractErrorAtTheEndOfChunk(chunk, tag)
    expect(err).toBeDefined()
    expect(err).toBeInstanceOf(Error)
    expect(err!.message).toBe(errMsg)
  })

  it('should handle a broken chunk', async () => {
    const chunk = new TextEncoder().encode(
      '\r\nsome random data \nthat does not conform\r\t to the protocol\r\n',
    )

    const err = extractErrorAtTheEndOfChunk(chunk, tag)
    expect(err).toBeDefined()
    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toContain('error in the stream')
  })

  it('should handle a partial of a valid chunk', async () => {
    const chunk = buildValidErrorChunk(errMsg, tag).slice(0, 20)

    const err = extractErrorAtTheEndOfChunk(chunk, tag)
    expect(err).toBeDefined()
    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toContain('error in the stream')
  })
})

describe('utils/stream RawStreamExceptionDetector', () => {
  const errMsg = 'boom'
  const tag = 'FOOBAR'

  // Binary payload that contains \r\n (0x0d 0x0a) byte sequences, which used to
  // be misinterpreted as the mid-stream exception marker by the row-oriented
  // stream() parser. Regression test for the "failed to parse the message
  // length" error reported for the Parquet format.
  // https://github.com/ClickHouse/clickhouse-js/issues/607
  const binaryWithCRLF = new Uint8Array([
    1, 2, 0x0d, 0x0a, 3, 4, 0x0d, 0x0a, 0x0d, 0x0a, 5, 6, 7, 8, 9, 10,
  ])

  function feed(chunks: Uint8Array[]): {
    data: Uint8Array
    error?: Error
  } {
    const detector = new RawStreamExceptionDetector(tag)
    const out: number[] = []
    for (const chunk of chunks) {
      const data = detector.push(chunk)
      out.push(...data)
    }
    const flushed = detector.flush()
    out.push(...flushed.data)
    return { data: new Uint8Array(out), error: flushed.error }
  }

  function splitEveryByte(bytes: Uint8Array): Uint8Array[] {
    return Array.from(bytes, (b) => new Uint8Array([b]))
  }

  it('should pass binary data containing \\r\\n through unchanged', () => {
    const { data, error } = feed([binaryWithCRLF])
    expect(error).toBeUndefined()
    expect(Array.from(data)).toEqual(Array.from(binaryWithCRLF))
  })

  it('should not produce false positives across chunk boundaries', () => {
    const { data, error } = feed(splitEveryByte(binaryWithCRLF))
    expect(error).toBeUndefined()
    expect(Array.from(data)).toEqual(Array.from(binaryWithCRLF))
  })

  it('should detect a real exception appended after binary data', () => {
    const exception = buildExceptionBlock(errMsg, tag)
    const full = concat(binaryWithCRLF, exception)

    const { data, error } = feed([full])
    // the binary part is preserved and emitted untouched
    expect(Array.from(data)).toEqual(Array.from(binaryWithCRLF))
    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toBe(errMsg)
  })

  it('should detect an exception split across the start marker boundary', () => {
    const exception = buildExceptionBlock(errMsg, tag)
    const full = concat(binaryWithCRLF, exception)
    // split in the middle of the "\r\n__exception__\r\n<tag>" start marker
    const splitAt = binaryWithCRLF.length + 5

    const { data, error } = feed([
      full.subarray(0, splitAt),
      full.subarray(splitAt),
    ])
    expect(Array.from(data)).toEqual(Array.from(binaryWithCRLF))
    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toBe(errMsg)
  })
})

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length)
  result.set(a, 0)
  result.set(b, a.length)
  return result
}

/** The exception block the server appends at the end of the stream. */
function buildExceptionBlock(errMsg: string, tag: string): Uint8Array {
  const blockStr =
    '\r\n__exception__\r\n' +
    tag +
    '\n' +
    errMsg +
    '\n' +
    (errMsg.length + 1) + // +1 to len for the newline character
    ' ' +
    tag +
    '\r\n__exception__\r\n'
  return new TextEncoder().encode(blockStr)
}

/**
 * \r\n__exception__\r\nFOOBAR
 * boom
 * 5 FOOBAR\r\n__exception__\r\n
 */
export function buildValidErrorChunk(errMsg: string, tag: string): Uint8Array {
  const chunkStr =
    'body-body-body-body\r\n__exception__\r\n' +
    tag +
    '\n' +
    errMsg +
    '\n' +
    (errMsg.length + 1) + // +1 to len for the newline character
    ' ' +
    tag +
    '\r\n__exception__\r\n'
  return new TextEncoder().encode(chunkStr)
}
