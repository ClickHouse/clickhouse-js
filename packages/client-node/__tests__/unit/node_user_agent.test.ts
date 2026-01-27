import { describe, it, expect, beforeEach, vi } from 'vitest'
import sinon from 'sinon'
import { getUserAgent } from '../../src/utils'
import { Runtime } from '../../src/utils/runtime'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('[Node.js] User-Agent', () => {
  const sandbox = sinon.createSandbox()
  beforeEach(() => {
    sandbox.stub(Runtime, 'package').value('0.0.42')
    sandbox.stub(Runtime, 'node').value('v16.144')
    sandbox.stub(Runtime, 'os').value('freebsd')
  })

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
