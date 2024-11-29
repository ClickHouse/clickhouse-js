import Stream from 'stream'

// See https://github.com/v8/v8/commit/ea56bf5513d0cbd2a35a9035c5c2996272b8b728
const MaxStringLength = Math.pow(2, 29) - 24

export function isStream(obj: any): obj is Stream.Readable {
  return obj !== null && typeof obj.pipe === 'function'
}

export async function getAsText(stream: Stream.Readable): Promise<string> {
  let text = ''

  const textDecoder = new TextDecoder()
  for await (const chunk of stream) {
    const decoded = textDecoder.decode(chunk, { stream: true })
    if (decoded.length + text.length > MaxStringLength) {
      throw new Error(
        'The response length exceeds the maximum allowed size of V8 String: ' +
          `${MaxStringLength}; consider limiting the amount of requested rows.`,
      )
    }
    text += decoded
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
