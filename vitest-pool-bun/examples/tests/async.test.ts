import { expect, test } from 'vitest'
import { add, asyncDouble } from '../src/math.js'

test('async/await with an imported local module', async () => {
  const doubled = await asyncDouble(21)
  expect(doubled).toBe(42)
  expect(add(40, 2)).toBe(42)
})

// Intentional failure: STOP gate 2 requires the reported stack trace to point
// at the original TypeScript source line below (the `expect(...)` call).
test('reports a failing assertion with a TS-mapped stack', () => {
  expect(add(2, 2)).toBe(5)
})
