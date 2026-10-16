import { expect, test } from 'vitest'

// Diagnostics fixture (NOT part of the default demo suite).
//
// When BUN_POOL_CRASH=1, the test abruptly kills the Bun worker mid-run to
// simulate a runtime crash / channel disconnect. The host (`BunPoolWorker` +
// Vitest's PoolRunner) must surface a clear, actionable error and terminate the
// run instead of hanging indefinitely (Phase 4 / STOP gate 4).
test('worker crash is surfaced, not hung', () => {
  if (process.env.BUN_POOL_CRASH === '1') {
    // Hard-kill this Bun process while the host is waiting for results.
    process.exit(137)
  }
  expect(true).toBe(true)
})
