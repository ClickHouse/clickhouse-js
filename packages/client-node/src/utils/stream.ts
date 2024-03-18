import Stream from 'stream'

export function isStream(obj: any): obj is Stream.Readable {
  return obj !== null && typeof obj.pipe === 'function'
}

export async function getAsText(stream: Stream.Readable): Promise<{
  text: string
  processed_bytes: number
}> {
  let processedBytes = 0
  const textRows: string[] = []
  const textDecoder = new TextDecoder()

  await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => {
      textRows.push(textDecoder.decode(chunk, { stream: true }))
      processedBytes += chunk.length
    })
    stream.on('end', resolve)
    stream.on('error', reject)
  })

  // flush
  const last = textDecoder.decode()
  if (last) {
    textRows.push(last)
    processedBytes += last.length
  }
  return {
    text: textRows.join(''),
    processed_bytes: processedBytes,
  }
}

export function mapStream(
  mapper: (input: unknown) => string
): Stream.Transform {
  return new Stream.Transform({
    objectMode: true,
    transform(chunk, encoding, callback) {
      callback(null, mapper(chunk))
    },
  })
}
