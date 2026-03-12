import { describe, expect, it } from 'vitest'
import Stream from 'stream'
import { constants } from 'buffer'

import { getAsText } from '../../src/utils/stream'

function makeStreamFromStrings(chunks: string[]): Stream.Readable {
  const encoder = new TextEncoder()
  async function* gen() {
    for (const chunk of chunks) {
      yield encoder.encode(chunk)
    }
  }
  return Stream.Readable.from(gen(), { objectMode: false })
}

function makeStreamFromBuffers(chunks: Buffer[]): Stream.Readable {
  async function* gen() {
    for (const chunk of chunks) {
      yield chunk
    }
  }
  return Stream.Readable.from(gen(), { objectMode: false })
}

describe('getAsText', () => {
  it('should return a string containing the concatenated chunks', async () => {
    expect(await getAsText(makeStreamFromStrings(['123', '456']))).toBe(
      '123456',
    )
  })

  it('should throw a custom error if the stream is too long for a string', async () => {
    const bigChunk = Buffer.alloc((constants.MAX_STRING_LENGTH / 8) >> 0)
    await expect(
      getAsText(
        makeStreamFromBuffers([
          bigChunk,
          bigChunk,
          bigChunk,
          bigChunk,
          bigChunk,
          bigChunk,
          bigChunk,
          bigChunk,
          bigChunk,
          bigChunk,
        ]),
      ),
    ).rejects.toThrowError(
      'The response length exceeds the maximum allowed size of V8 String:',
    )
  })
})
