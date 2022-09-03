import type { ClickHouseClientConfigOptions, Logger } from '../../src'
import { type ClickHouseClient, createClient } from '../../src'
import { createTestClient } from '../utils'

describe('config', () => {
  let client: ClickHouseClient
  let messages: string[] = []

  afterEach(async () => {
    await client.close()
    if (messages.length) {
      messages = []
    }
  })

  it('should set request timeout with "request_timeout" setting', async () => {
    client = createTestClient({
      request_timeout: 100,
    })

    await expect(
      client.select({
        query: 'SELECT sleep(3)',
      })
    ).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringMatching('Timeout error'),
      })
    )
  })

  it('should not mutate provided configuration', async () => {
    const config: ClickHouseClientConfigOptions = {
      host: 'http://localhost',
    }
    client = createClient(config)
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

  it('should specify the default database name on creation', async () => {
    client = createTestClient({
      database: 'system',
    })
    const result = await client.select({
      query: 'SELECT * FROM numbers LIMIT 2',
      format: 'TabSeparated',
    })
    expect(await result.text()).toEqual('0\n1\n')
  })

  it('should provide a custom logger implementation', async () => {
    client = createTestClient({
      log: {
        enable: true,
        LoggerClass: TestLogger,
      },
    })
    await client.ping()
    expect(messages).toContainEqual(expect.stringContaining('GET /ping'))
  })

  it('should provide a custom logger implementation (but logs are disabled)', async () => {
    client = createTestClient({
      log: {
        enable: false,
        LoggerClass: TestLogger,
      },
    })
    await client.ping()
    expect(messages).toHaveLength(0)
  })

  class TestLogger implements Logger {
    constructor(readonly enabled: boolean) {}
    debug(message: string) {
      if (this.enabled) {
        messages.push(message)
      }
    }
    info(message: string) {
      if (this.enabled) {
        messages.push(message)
      }
    }
    warning(message: string) {
      if (this.enabled) {
        messages.push(message)
      }
    }
    error(message: string) {
      if (this.enabled) {
        messages.push(message)
      }
    }
  }
})
