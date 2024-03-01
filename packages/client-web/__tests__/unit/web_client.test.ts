import type { BaseClickHouseClientConfigOptions } from '@clickhouse/client-common'
import { createClient } from '../../src'

describe('[Web] createClient', () => {
  it('throws on incorrect "url" config value', () => {
    expect(() => createClient({ url: 'foo' })).toThrow(
      jasmine.objectContaining({
        message: jasmine.stringContaining('ClickHouse URL is malformed.'),
      })
    )
  })

  it('should not mutate provided configuration', async () => {
    const config: BaseClickHouseClientConfigOptions = {
      url: 'https://localhost:8443',
    }
    createClient(config)
    // initial configuration is not overridden by the defaults we assign
    // when we transform the specified config object to the connection params
    expect(config).toEqual({
      url: 'https://localhost:8443',
    })
  })
})
