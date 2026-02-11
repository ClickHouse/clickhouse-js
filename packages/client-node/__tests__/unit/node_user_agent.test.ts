import { describe, it, expect, vi, afterAll } from 'vitest'
import { getUserAgent } from '../../src/utils'
import type * as runtime from '../../src/utils/runtime'

vi.mock('../../src/utils/runtime', async () => {
  const actual = await vi.importActual<typeof runtime>(
    '../../src/utils/runtime',
  )
  return {
    ...actual,
    Runtime: {
      ...actual.Runtime,
      package: '0.0.42',
      node: 'v16.144',
      os: 'freebsd',
    },
  }
})

afterAll(() => {
  vi.clearAllMocks()
})

describe('[Node.js] User-Agent', () => {
  it('should generate a user agent without app id', async () => {
    const userAgent = getUserAgent()
    expect(userAgent).toEqual(
      'clickhouse-js/0.0.42 (lv:nodejs/v16.144; os:freebsd)',
    )
  })

  it('should generate a user agent with app id', async () => {
    const userAgent = getUserAgent()
    expect(userAgent).toEqual(
      'clickhouse-js/0.0.42 (lv:nodejs/v16.144; os:freebsd)',
    )
  })
})
