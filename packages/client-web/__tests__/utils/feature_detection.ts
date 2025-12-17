export function isAwaitUsingStatementSupported(): boolean {
  try {
    eval(`
      (async () => {
          await using c = null;
      })
    `)
    return true
  } catch {
    return false
  }
}

export function isUsingStatementSupported(): boolean {
  try {
    eval(`
      (() => {
          using c = null;
      })
    `)
    return true
  } catch {
    return false
  }
}
