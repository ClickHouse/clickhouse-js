import { describe, expect, test } from 'vitest'
import { asyncDouble } from '../src/math.js'

describe('async suite running in Bun', () => {
  test('resolves multiple async operations', async () => {
    const results = await Promise.all([asyncDouble(1), asyncDouble(2), asyncDouble(3)])
    expect(results).toEqual([2, 4, 6])
  })

  test('uses Bun timers', async () => {
    const start = Date.now()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(Date.now() - start).toBeGreaterThanOrEqual(4)
  })
})
