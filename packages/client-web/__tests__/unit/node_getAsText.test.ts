import { describe, expect, it } from 'vitest'
import { getAsText } from '../../src/utils/stream'

const MaxStringLength = Math.pow(2, 29) - 24

// ReadableStream.from() polyfill-ish
function generatorToStream(
  gen: AsyncGenerator<Uint8Array>,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await gen.next()
      if (done) {
        controller.close()
      } else {
        controller.enqueue(value)
      }
    },
  })
}

function makeStreamFromStrings(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  async function* gen() {
    for (const chunk of chunks) {
      yield encoder.encode(chunk)
    }
  }
  return generatorToStream(gen())
}

function makeStreamFromBuffers(
  chunks: Uint8Array[],
): ReadableStream<Uint8Array> {
  async function* gen() {
    for (const chunk of chunks) {
      yield chunk
    }
  }
  return generatorToStream(gen())
}

describe('getAsText', () => {
  it('should return a string containing the concatenated chunks', async () => {
    expect(await getAsText(makeStreamFromStrings(['123', '456']))).toBe(
      '123456',
    )
  })

  it('should throw a custom error if the stream is too long for a string', async () => {
    // Passing the fill option is fine as Node always fills the buffer with zeroes otherwise
    const bigChunk = new Uint8Array((MaxStringLength / 8) >> 0).fill(97) // 'a'
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
    const bigChunk = new Uint8Array((MaxStringLength / 8) >> 0).fill(98) // 'b'
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
      new Uint8Array([0xe2, 0x82]), // first 2 bytes of '€'
      new Uint8Array([0xac, 0x20, 0x61]), // last byte of '€', space and 'a'
    ])
    const text = '€ a'
    expect(await getAsText(stream)).toBe(text)
  })

  it('should flush the decoder at the end of the stream', async () => {
    const stream = makeStreamFromBuffers([
      new Uint8Array([0x61, 0x20, 0xe2, 0x82]), // first 2 bytes of '€'
      // no more bytes, but the decoder should be flushed and return the butes it has buffered
    ])
    const text = 'a \ufffd'
    expect(await getAsText(stream)).toBe(text)
  })
})
