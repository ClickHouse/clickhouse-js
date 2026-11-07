import { expect, test } from 'vitest'

// Proves execution actually happens inside Bun, not the Node host.
test('runs inside the Bun runtime', () => {
  expect(typeof Bun).not.toBe('undefined')
})

test('1 + 1 === 2', () => {
  expect(1 + 1).toBe(2)
})

// Proves Vitest `setupFiles` ran inside the Bun worker (see examples/setup.ts).
test('setup file executed in the Bun worker', () => {
  expect((globalThis as Record<string, unknown>).__BUN_POOL_SETUP__).toBe(true)
})
