import * as p from 'client-node/src/process'
import { getProcessVersion } from 'client-node/src/process'
import * as os from 'os'
import { getUserAgent } from 'client-node/src/user_agent'

jest.mock('os')
jest.mock('client-common/src/version', () => {
  return '0.0.42'
})
describe('Node.js User-Agent', () => {
  describe('process util', () => {
    it('should get correct process version by default', async () => {
      expect(getProcessVersion()).toEqual(process.version)
    })
  })

  it('should generate a user agent without app id', async () => {
    setupMocks()
    const userAgent = getUserAgent()
    expect(userAgent).toEqual(
      'clickhouse-js/0.0.42 (lv:nodejs/v16.144; os:freebsd)'
    )
  })

  it('should generate a user agent with app id', async () => {
    setupMocks()
    const userAgent = getUserAgent()
    expect(userAgent).toEqual(
      'clickhouse-js/0.0.42 (lv:nodejs/v16.144; os:freebsd)'
    )
  })

  function setupMocks() {
    jest.spyOn(os, 'platform').mockReturnValueOnce('freebsd')
    jest.spyOn(p, 'getProcessVersion').mockReturnValueOnce('v16.144')
  }
})
