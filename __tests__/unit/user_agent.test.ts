import * as p from '../../src/utils/process'
import { getProcessVersion } from '../../src/utils/process'
import * as os from 'os'
import { getUserAgent } from '../../src/utils/user_agent'

jest.mock('os')
jest.mock('../../src/version', () => {
  return '0.0.42'
})
describe('user_agent', () => {
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
