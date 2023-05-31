export function isStream(obj: any): obj is ReadableStream {
  return (
    obj !== null && obj !== undefined && typeof obj.pipeThrough === 'function'
  )
}

export async function getAsText(stream: ReadableStream): Promise<string> {
  let result = ''
  let isDone = false

  const textDecoder = new TextDecoder()
  const reader = stream.getReader()

  while (!isDone) {
    const { done, value } = await reader.read()
    result += textDecoder.decode(value, { stream: true })
    isDone = done
  }

  // flush
  result += textDecoder.decode()
  return result
}

export function mapStream(mapper: (input: any) => any): ReadableStream {
  throw new Error('not implemented')
}
