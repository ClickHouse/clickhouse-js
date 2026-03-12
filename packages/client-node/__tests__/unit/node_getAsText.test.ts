import { describe, expect, it } from 'vitest'
import Stream from 'stream'
import { constants } from 'buffer'

import { getAsText } from '../../src/utils/stream'

function makeRowsStream(chunks: string[]): Stream.Readable {
  const encoder = new TextEncoder()
  async function* gen() {
    for (const chunk of chunks) {
      yield encoder.encode(chunk)
    }
  }
  return Stream.Readable.from(gen(), { objectMode: false })
}

describe('getAsText', () => {
  it('should return a string containing the concatenated chunks', async () => {
    expect(await getAsText(makeRowsStream(['123', '456']))).toBe('123456')
  })

  it('should throw a custom error if the stream is too long for a string', async () => {
    const longString =
      '1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890'.repeat(
        1000,
      )
    console.log('!!!!!!!!!!!!!!!!!!!!')
    console.log(constants.MAX_STRING_LENGTH)
    console.log(longString.length)
    console.log('!!!!!!!!!!!!!!!!!!!!')
    const longChunk = longString.repeat(
      constants.MAX_STRING_LENGTH / longString.length / 2,
    )

    expect(
      getAsText(makeRowsStream([longChunk, longChunk, longChunk, longChunk])),
    ).rejects.toThrowError(
      'The response length exceeds the maximum allowed size of V8 String:',
    )
  })
})
