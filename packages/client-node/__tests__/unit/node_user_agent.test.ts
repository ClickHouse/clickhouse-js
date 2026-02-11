import { describe, it, expect, vi } from 'vitest'
import { getUserAgent } from '../../src/utils'

vi.mock(import('../../src/utils/runtime'), () => {
  return {
    // Object.create is used to prove to TS that
    // the prototype property exists.
    Runtime: Object.create({
      package: '0.0.42',
      node: 'v16.144',
      os: 'freebsd',
    }),
  }
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
