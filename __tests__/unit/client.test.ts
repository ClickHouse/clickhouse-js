import type { ClickHouseClientConfigOptions } from '../../src'
import { createClient } from '../../src'

describe('createClient', () => {
  it('throws on incorrect "host" config value', () => {
    expect(() => createClient({ host: 'foo' })).toThrowError(
      'Configuration parameter "host" contains malformed url.'
    )
  })

  it('should not mutate provided configuration', async () => {
    const config: ClickHouseClientConfigOptions = {
      host: 'http://localhost',
    }
    createClient(config)
    // none of the initial configuration settings are overridden
    // by the defaults we assign when we normalize the specified config object
    expect(config).toEqual({
      host: 'http://localhost',
      request_timeout: undefined,
      max_open_connections: undefined,
      tls: undefined,
      compression: undefined,
      username: undefined,
      password: undefined,
      application: undefined,
      database: undefined,
      clickhouse_settings: undefined,
      log: undefined,
    })
  })
})
