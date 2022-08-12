export type RetryOnFailureOptions = {
  maxAttempts?: number;
  waitBetweenAttempts?: number;
  logRetries?: boolean;
};

export async function retryOnFailure<T>(
  fn: () => Promise<T>,
  options?: RetryOnFailureOptions
): Promise<T> {
  const maxAttempts = validate(options?.maxAttempts) ?? 200;
  const waitBetweenAttempts = validate(options?.waitBetweenAttempts) ?? 50;
  const logRetries = options?.logRetries ?? false;

  let attempts = 0;

  const attempt: () => Promise<T> = async () => {
    try {
      return await fn();
    } catch (e: any) {
      if (++attempts === maxAttempts) {
        console.error(
          `Final fail after ${attempts} attempt(s) every ${waitBetweenAttempts} ms\n`,
          e.message
        );
        throw e;
      }
      if (logRetries) {
        console.error(
          `Failure after ${attempts} attempt(s), will retry\n`,
          e.message
        );
      }
      await sleep(waitBetweenAttempts);
      return await attempt();
    }
  };

  return await attempt();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    // @ts-expect-error. setTimeout has typings of window.setTimeout & globals.setTimeout
    // remove me when DOM lib is excluded from typings.
    setTimeout(resolve, ms).unref();
  });
}

function validate(value: undefined | number): typeof value {
  if (value !== undefined && value < 1) {
    throw new Error(`Expect maxTries to be at least 1`);
  }
  return value;
}
