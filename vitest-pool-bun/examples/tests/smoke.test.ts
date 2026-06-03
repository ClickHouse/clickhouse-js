import { expect, test } from 'vitest'

// Proves execution actually happens inside Bun, not the Node host.
test('runs inside the Bun runtime', () => {
  expect(typeof Bun).not.toBe('undefined')
})

test('1 + 1 === 2', () => {
  expect(1 + 1).toBe(2)
})
