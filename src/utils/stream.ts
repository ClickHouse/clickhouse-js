import Stream from "stream";

export function isStream(obj: any): obj is Stream.Readable {
  return (
    !!obj &&
    typeof obj === 'object' &&
    'pipe' in obj &&
    typeof obj.pipe === 'function'
  )
}

export async function getAsText(
  stream: NodeJS.ReadableStream | null
): Promise<string> {
  if (stream === null) {
    return ''
  }

  let result = ''
  const textDecoder = new TextDecoder()

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    result += textDecoder.decode(buffer, { stream: true })
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
