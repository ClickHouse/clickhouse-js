import { describe, it, expect, vi, beforeAll } from 'vitest'
import { getUserAgent } from '../../src/utils'
import { Runtime } from '../../src/utils/runtime'

beforeAll(() => {
  // Mock Runtime to have a fixed package version and node version for testing
  vi.spyOn(Runtime, 'package', 'get').mockReturnValue('0.0.42')
  vi.spyOn(Runtime, 'node', 'get').mockReturnValue('v16.144')
  vi.spyOn(Runtime, 'os', 'get').mockReturnValue('freebsd')
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
