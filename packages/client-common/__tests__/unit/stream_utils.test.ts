import { describe, it, expect } from 'vitest'
import { extractErrorAtTheEndOfChunk } from '../../src/index'

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
