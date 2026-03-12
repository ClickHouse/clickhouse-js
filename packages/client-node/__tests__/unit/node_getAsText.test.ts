import { describe, expect, it } from 'vitest'
import Stream from 'stream'
import { getAsText } from '../../src/utils/stream'

function makeRowsStream() {
  const encoder = new TextEncoder()
  async function* gen() {
    yield encoder.encode('1')
    yield encoder.encode('2')
  }
  return Stream.Readable.from(gen(), { objectMode: false })
}

describe('getAsText', () => {
  it('should return a string', async () => {
    expect(await getAsText(makeRowsStream())).toBe('12')
  })
})
