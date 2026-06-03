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

/**
 * Detects whether the tests are running under the Bun runtime (via
 * `bun --bun vitest`) as opposed to Node.js. Bun reimplements the `node:http`
 * module on top of JavaScriptCore, so several low-level HTTP behaviors that the
 * Node.js client relies on (e.g. `Http.Agent` `maxSockets`/`freeSockets`
 * enforcement, `maxHeaderSize` overflow errors, socket keep-alive timeout
 * tracking, and the exact text of socket-level errors) differ from Node.js.
 * Tests that assert on those Node.js-specific internals are skipped under Bun.
 */
export function isBun(): boolean {
  return (
    typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined' ||
    typeof (process as { versions?: { bun?: string } }).versions?.bun ===
      'string'
  )
}
