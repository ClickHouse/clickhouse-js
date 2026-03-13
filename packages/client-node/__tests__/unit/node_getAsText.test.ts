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
    // Passing the fill option is fine as Node always fills the buffer with zeroes otherwise
    const bigChunk = Buffer.alloc((constants.MAX_STRING_LENGTH / 8) >> 0, 'a')
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

  it('should now throw on big but not too big streams', async () => {
    const bigChunk = Buffer.alloc((constants.MAX_STRING_LENGTH / 8) >> 0, 'b')
    expect(
      await getAsText(
        makeStreamFromBuffers([
          bigChunk,
          bigChunk,
          bigChunk,
          bigChunk,
          bigChunk,
        ]),
      ),
    ).toHaveLength(335_544_305)
  })

  it('should use streamed decoding and not break utf-8 characters', async () => {
    const stream = makeStreamFromBuffers([
      Buffer.from([0xe2, 0x82]), // first 2 bytes of '€'
      Buffer.from([0xac, 0x20, 0x61]), // last byte of '€', space and 'a'
    ])
    const text = '€ a'
    expect(await getAsText(stream)).toBe(text)
  })

  it('should flush the decoder at the end of the stream', async () => {
    const stream = makeStreamFromBuffers([
      Buffer.from([0x61, 0x20, 0xe2, 0x82]), // first 2 bytes of '€'
      // no more bytes, but the decoder should be flushed and return the butes it has buffered
    ])
    const text = 'a \ufffd'
    expect(await getAsText(stream)).toBe(text)
  })
})
