import { describe, it, expect } from 'vitest'
import {
  extractErrorAtTheEndOfChunk,
  extractErrorAtTheEndOfChunkStrict,
} from '../../src/index'

describe('utils/stream', () => {
  const errMsg = 'boom'
  // 16 ASCII characters
  const tag = '[1234567890ABCD]'

  it('should handle a valid error chunk', async () => {
    const chunk = buildValidErrorChunk(errMsg, tag)

    const err = extractErrorAtTheEndOfChunk(chunk, tag)
    expect(err).toBeDefined()
    expect(err).toBeInstanceOf(Error)
    expect(err!.message).toBe(errMsg)
  })

  it('should not handle an error-looking chunk with a mismatch tag', async () => {
    const chunk = buildValidErrorChunk(errMsg, tag)

    const err = extractErrorAtTheEndOfChunkStrict(chunk, '[MISMATCHEDTAG!]')
    expect(err).toBeNull()
  })

  it('should not error on a valid \\r\\n sequence', async () => {
    const chunk = new TextEncoder().encode(
      'this is a normal chunk with a newline\r\nnew chunk begins here',
    )

    const err = extractErrorAtTheEndOfChunkStrict(chunk, tag)
    expect(err).toBeNull()
  })

  it('should not error on a chunk without the closing __exception__ marker', async () => {
    const chunk = new TextEncoder().encode(
      `body-body-body\r\n__exception__\r\n${tag}\nboom\n5 ${tag}\r\n__excePtion__\r\n`,
    )

    const err = extractErrorAtTheEndOfChunkStrict(chunk, tag)
    expect(err).toBeNull()
  })

  it('should not loop forever if the exception chunk is malformed', async () => {
    const chunk = new TextEncoder().encode(
      'body-body-body\n\r\n__exception__\r\n' + tag,
    )

    const err = extractErrorAtTheEndOfChunk(chunk, tag)
    expect(err).toBeInstanceOf(Error)
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

  it('should parse a real world exception chunk', async () => {
    const err = extractErrorAtTheEndOfChunk(
      new TextEncoder().encode(
        "\r\n__exception__\r\nbavstjgvpumrqwto\r\nCode: 395. DB::Exception: valid exception 3: while executing 'FUNCTION throwIf(equals(__table1.number, 999999_UInt32) :: 0, 'valid exception 3'_String :: 2) -> throwIf(equals(__table1.number, 999999_UInt32), 'valid exception 3'_String) UInt8 : 3'. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 26.1.1.200 (official build))\n324 bavstjgvpumrqwto\r\n__exception__\r\n",
      ),
      'bavstjgvpumrqwto',
    )
    expect(err).toBeDefined()
    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toContain('valid exception 3')
  })
})

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
