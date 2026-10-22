import { expect, test } from 'vitest'
import { add } from '../src/math.js'

// Intentionally failing test (NOT part of the green demo suite).
//
// Demonstrates STOP gate 2: a failing assertion is reported as a real failure
// whose stack trace points at the original TypeScript source line below — the
// `expect(...)` call — proving host-side Vite source maps survive the Bun round
// trip. Run with `npm run demo:failure` (expected to exit non-zero).
test('failing assertion reports a TS-mapped stack', () => {
  expect(add(2, 2)).toBe(5)
})
