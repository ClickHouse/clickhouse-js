import Stream from 'stream'

export function isStream(obj: any): obj is Stream.Readable {
  return obj !== null && typeof obj.pipe === 'function'
}

export async function getAsText(stream: Stream.Readable): Promise<string> {
  let text = ''

  const textDecoder = new TextDecoder()
  for await (const chunk of stream) {
    text += textDecoder.decode(chunk, { stream: true })
  }

  // flush
  const last = textDecoder.decode()
  if (last) {
    text += last
  }

  return text
}

export function mapStream(
  mapper: (input: unknown) => string,
): Stream.Transform {
  return new Stream.Transform({
    objectMode: true,
    transform(chunk, encoding, callback) {
      callback(null, mapper(chunk))
    },
  })
}
