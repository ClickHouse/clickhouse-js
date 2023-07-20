import sinon from 'sinon'
import { getUserAgent } from '../../src/utils'
import * as version from '../../src/version'

describe('[Node.js] User-Agent', () => {
  const sandbox = sinon.createSandbox()
  beforeEach(() => {
    // Jasmine's spyOn won't work here: 'platform' property is not configurable
    sandbox.stub(process, 'platform').value('freebsd')
    sandbox.stub(process, 'version').value('v16.144')
    sandbox.stub(version, 'default').value('0.0.42')
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
