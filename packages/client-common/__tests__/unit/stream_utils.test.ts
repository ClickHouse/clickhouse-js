import { describe, it, expect } from 'vitest'
import { checkErrorInChunkAtIndex } from '@clickhouse/client-common'

describe('utils/stream', () => {
  const errMsg = 'boom'
  const tag = 'FOOBAR'

  it('should handle a valid error chunk', async () => {
    const chunk = buildValidErrorChunk(errMsg, tag)
    const newLineIdx = 1

    const err = checkErrorInChunkAtIndex(chunk, newLineIdx, tag)
    expect(err).toBeDefined()
    expect(err).toBeInstanceOf(Error)
    expect(err!.message).toBe(errMsg)
  })

  it('should handle a broken chunk', async () => {
    const chunk = new TextEncoder().encode(
      '\r\nsome random data \nthat does not conform\r\t to the protocol\r\n',
    )
    const newLineIdx = 1

    const err = checkErrorInChunkAtIndex(chunk, newLineIdx, tag)
    expect(err).toBeDefined()
    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toContain('error in the stream')
  })

  it('should handle a partial of a valid chunk', async () => {
    const chunk = buildValidErrorChunk(errMsg, tag).slice(0, 20)
    const newLineIdx = 1

    const err = checkErrorInChunkAtIndex(chunk, newLineIdx, tag)
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
    '\r\n__exception__\r\n' +
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
