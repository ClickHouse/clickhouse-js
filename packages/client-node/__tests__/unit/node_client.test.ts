import type { BaseClickHouseClientConfigOptions } from '@clickhouse/client-common'
import { createClient } from '../../src'

describe('[Node.js] createClient', () => {
  it('throws on incorrect "url" config value', () => {
    expect(() => createClient({ url: 'foo' })).toThrowError(
      'ClickHouse URL is malformed.'
    )
  })

  it('should not mutate provided configuration', async () => {
    const config: BaseClickHouseClientConfigOptions = {
      url: 'http://localhost',
    }
    createClient(config)
    // initial configuration is not overridden by the defaults we assign
    // when we transform the specified config object to the connection params
    expect(config).toEqual({
      url: 'http://localhost',
    })
  })
})
