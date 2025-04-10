import Stream from 'stream'
import { constants } from 'buffer'

const { MAX_STRING_LENGTH } = constants

export function isStream(obj: unknown): obj is Stream.Readable {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'pipe' in obj &&
    typeof obj.pipe === 'function' &&
    'on' in obj &&
    typeof obj.on === 'function'
  )
}

export async function getAsText(stream: Stream.Readable): Promise<string> {
  let text = ''

  const textDecoder = new TextDecoder()
  for await (const chunk of stream) {
    const decoded = textDecoder.decode(chunk, { stream: true })
    if (decoded.length + text.length > MAX_STRING_LENGTH) {
      throw new Error(
        'The response length exceeds the maximum allowed size of V8 String: ' +
          `${MAX_STRING_LENGTH}; consider limiting the amount of requested rows.`,
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
