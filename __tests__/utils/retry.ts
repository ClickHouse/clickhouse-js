export type RetryOnFailureOptions = {
  maxAttempts?: number
  waitBetweenAttemptsMs?: number
  logRetries?: boolean
}

export async function retryOnFailure<T>(
  fn: () => Promise<T>,
  options?: RetryOnFailureOptions
): Promise<T> {
  const maxAttempts = validate(options?.maxAttempts) ?? 200
  const waitBetweenAttempts = validate(options?.waitBetweenAttemptsMs) ?? 50
  const logRetries = options?.logRetries ?? false

  let attempts = 0

  const attempt: () => Promise<T> = async () => {
    try {
      return await fn()
    } catch (e: any) {
      if (++attempts === maxAttempts) {
        console.error(
          `Final fail after ${attempts} attempt(s) every ${waitBetweenAttempts} ms\n`,
          e.message
        )
        throw e
      }
      if (logRetries) {
        console.error(
          `Failure after ${attempts} attempt(s), will retry\n`,
          e.message
        )
      }
      await sleep(waitBetweenAttempts)
      return await attempt()
    }
  }

  return await attempt()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref()
  })
}

function validate(value: undefined | number): typeof value {
  if (value !== undefined && value < 1) {
    throw new Error(`Expect maxTries to be at least 1`)
  }
  return value
}
