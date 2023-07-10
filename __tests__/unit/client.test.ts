import type { ClickHouseClientConfigOptions } from '../../src'
import { createClient } from '../../src'

describe('createClient', () => {
  it('throws on incorrect "host" or "url" config value', () => {
    expect(() => createClient({ host: 'foo' })).toThrowError(
      'Configuration parameter "host" or "url" contains malformed url.'
    )
  })

  it('should accept url connection string and not mutate provided configuration', async () => {
    const config: ClickHouseClientConfigOptions = {
      url: 'clickhouse://default:password@localhost/default',
      password: 'foobar',
    }
    createClient(config)
    // none of the initial configuration settings are overridden
    // by the defaults we assign when we normalize the specified config object
    expect(config).toEqual({
      url: 'clickhouse://default:password@localhost/default',
      request_timeout: undefined,
      max_open_connections: undefined,
      tls: undefined,
      compression: undefined,
      username: undefined,
      password: 'foobar',
      application: undefined,
      database: undefined,
      clickhouse_settings: undefined,
      log: undefined,
    })
  })
})
