import Stream from 'stream'
import { getAsText } from '../../src/utils'

export function makeRawStream() {
  return new Stream.Readable({
    objectMode: false,
    read() {
      /* stub */
    },
  })
}

export function makeObjectStream() {
  return new Stream.Readable({
    objectMode: true,
    read() {
      /* stub */
    },
  })
}

export async function readTextFromStream(stream: Stream.Readable) {
  const { text } = await getAsText(stream)
  return text
}
