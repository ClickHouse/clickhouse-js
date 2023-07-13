import * as os from 'os'
import { getProcessVersion, getUserAgent } from '../../src/utils'
import * as p from '../../src/utils/process'

// FIXME: proper mocks
xdescribe('Node.js User-Agent', () => {
  beforeEach(() => {
    spyOnProperty(os, 'platform').and.returnValue(() => 'freebsd')
    spyOnProperty(p, 'getProcessVersion').and.returnValue(() => 'v16.144')
  })

  // const versionSpy = spyOn(version, 'default').and.returnValue('0.0.42')
  describe('process util', () => {
    it('should get correct process version by default', async () => {
      expect(getProcessVersion()).toEqual(process.version)
    })
  })

  it('should generate a user agent without app id', async () => {
    const userAgent = getUserAgent()
    expect(userAgent).toEqual(
      'clickhouse-js/0.0.42 (lv:nodejs/v16.144; os:freebsd)'
    )
  })

  it('should generate a user agent with app id', async () => {
    const userAgent = getUserAgent()
    expect(userAgent).toEqual(
      'clickhouse-js/0.0.42 (lv:nodejs/v16.144; os:freebsd)'
    )
  })
})
