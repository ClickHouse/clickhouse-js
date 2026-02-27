/**
 * @deprecated This utility function is not intended to be used outside of the client implementation anymore. Please, use `setTimeout` directly or a more full-featured utility library if you need additional features like cancellation or timers management.
 */
export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) =>
    setTimeout(() => {
      resolve(void 0)
    }, ms),
  )
}
