import { expect, test } from 'vitest'
import { add, asyncDouble } from '../src/math.js'

test('async/await with an imported local module', async () => {
  const doubled = await asyncDouble(21)
  expect(doubled).toBe(42)
  expect(add(40, 2)).toBe(42)
})
