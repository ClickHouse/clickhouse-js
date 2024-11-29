// See https://github.com/v8/v8/commit/ea56bf5513d0cbd2a35a9035c5c2996272b8b728
const MaxStringLength = Math.pow(2, 29) - 24

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
    const decoded = textDecoder.decode(value, { stream: true })
    if (decoded.length + result.length > MaxStringLength) {
      throw new Error(
        'The response length exceeds the maximum allowed size of V8 String: ' +
          `${MaxStringLength}; consider limiting the amount of requested rows.`,
      )
    }
    result += decoded
    isDone = done
  }

  // flush
  result += textDecoder.decode()
  return result
}
