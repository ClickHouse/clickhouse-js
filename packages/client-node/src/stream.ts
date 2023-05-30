import Stream from 'stream'

export function isStream(obj: any): obj is Stream.Readable {
  return obj !== null && typeof obj.pipe === 'function'
}

export async function getAsText(stream: Stream.Readable): Promise<string> {
  let result = ''
  const textDecoder = new TextDecoder()

  for await (const chunk of stream) {
    result += textDecoder.decode(chunk, { stream: true })
  }

  // flush
  result += textDecoder.decode()
  return result
}

export function mapStream(mapper: (input: any) => any): Stream.Transform {
  return new Stream.Transform({
    objectMode: true,
    transform(chunk, encoding, callback) {
      callback(null, mapper(chunk))
    },
  })
}
