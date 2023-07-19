import type { BaseClickHouseClientConfigOptions } from '@clickhouse/client-common'
import { createClient } from '../../src'

describe('Browser createClient', () => {
  it('throws on incorrect "host" config value', () => {
    expect(() => createClient({ host: 'foo' })).toThrowError(
      'Configuration parameter "host" contains malformed url.'
    )
  })

  it('should not mutate provided configuration', async () => {
    const config: BaseClickHouseClientConfigOptions<unknown> = {
      host: 'http://localhost',
    }
    createClient(config)
    // initial configuration is not overridden by the defaults we assign
    // when we transform the specified config object to the connection params
    expect(config).toEqual({
      host: 'http://localhost',
    })
  })
})
