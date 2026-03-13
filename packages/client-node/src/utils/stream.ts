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
  try {
    let text = ''

    const textDecoder = new TextDecoder()
    for await (const chunk of stream) {
      text += textDecoder.decode(chunk, { stream: true })
    }

    // flush unfinished multi-byte characters
    text += textDecoder.decode()

    return text
  } catch (err) {
    if (
      err instanceof RangeError &&
      err.message.includes('Invalid string length')
    ) {
      throw new Error(
        `The response length exceeds the maximum allowed size of V8 String: ${MAX_STRING_LENGTH} characters.`,
      )
    }
    throw err
  }
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
