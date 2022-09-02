import Stream from 'stream'

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
