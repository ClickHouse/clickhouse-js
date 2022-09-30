import type { Logger } from '../../src'
import { type ClickHouseClient } from '../../src'
import { createTestClient, retryOnFailure } from '../utils'
import type { RetryOnFailureOptions } from '../utils/retry'

describe('config', () => {
  let client: ClickHouseClient
  let logs: {
    message: string
    err?: Error
    args?: Record<string, unknown>
  }[] = []

  afterEach(async () => {
    await client.close()
    if (logs.length) {
      logs = []
    }
  })

  it('should set request timeout with "request_timeout" setting', async () => {
    client = createTestClient({
      request_timeout: 100,
    })

    await expect(
      client.query({
        query: 'SELECT sleep(3)',
      })
    ).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringMatching('Timeout error'),
      })
    )
  })

  it('should specify the default database name on creation', async () => {
    client = createTestClient({
      database: 'system',
    })
    const result = await client.query({
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
    expect(logs[0]).toEqual({
      message: '[HTTP Adapter] Got a response from ClickHouse',
      args: expect.objectContaining({
        request_path: '/ping',
        request_method: 'GET',
      }),
    })
  })

  it('should provide a custom logger implementation (but logs are disabled)', async () => {
    client = createTestClient({
      log: {
        enable: false,
        LoggerClass: TestLogger,
      },
    })
    await client.ping()
    expect(logs).toHaveLength(0)
  })

  describe('max_open_connections', () => {
    let results: number[] = []
    afterEach(() => {
      results = []
    })

    const retryOpts: RetryOnFailureOptions = {
      maxAttempts: 20,
    }

    function select(query: string) {
      return client
        .query({
          query,
          format: 'JSONEachRow',
        })
        .then((r) => r.json<[{ x: number }]>())
        .then(([{ x }]) => results.push(x))
    }

    it('should use only one connection', async () => {
      client = createTestClient({
        max_open_connections: 1,
      })
      void select('SELECT 1 AS x, sleep(0.2)')
      void select('SELECT 2 AS x, sleep(0.2)')
      await retryOnFailure(async () => {
        expect(results).toEqual([1])
      }, retryOpts)
      await retryOnFailure(async () => {
        expect(results).toEqual([1, 2])
      }, retryOpts)
    })

    it('should use several connections', async () => {
      client = createTestClient({
        max_open_connections: 2,
      })
      void select('SELECT 1 AS x, sleep(0.2)')
      void select('SELECT 2 AS x, sleep(0.2)')
      void select('SELECT 3 AS x, sleep(0.2)')
      void select('SELECT 4 AS x, sleep(0.2)')
      await retryOnFailure(async () => {
        expect(results).toContain(1)
        expect(results).toContain(2)
        expect(results.length).toEqual(2)
      }, retryOpts)
      await retryOnFailure(async () => {
        expect(results).toContain(3)
        expect(results).toContain(4)
        expect(results.length).toEqual(4)
      }, retryOpts)
    })
  })

  class TestLogger implements Logger {
    constructor(readonly enabled: boolean) {}
    debug(message: string, args?: Record<string, unknown>) {
      if (this.enabled) {
        logs.push({ message, args })
      }
    }
    info(message: string, args?: Record<string, unknown>) {
      if (this.enabled) {
        logs.push({ message, args })
      }
    }
    warning(message: string, args?: Record<string, unknown>) {
      if (this.enabled) {
        logs.push({ message, args })
      }
    }
    error(message: string, err: Error, args?: Record<string, unknown>) {
      if (this.enabled) {
        logs.push({ message, err, args })
      }
    }
  }
})
