export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) =>
    setTimeout(() => {
      resolve(void 0)
    }, ms),
  )
}
