import type {
  ClickHouseClient,
  ErrorLogParams,
  Logger,
  LogParams,
} from '@clickhouse/client-common'
import { describe, it, afterEach, expect, vi } from 'vitest'
import { ClickHouseLogLevel } from '@clickhouse/client-common'
import { createTestClient } from '@test/utils/client'

describe('[Node.js] logger support', () => {
  let client: ClickHouseClient
  let logs: {
    message: string
    err?: Error
    args?: Record<string, unknown>
  }[] = []

  afterEach(async () => {
    await client.close()
    logs = []
  })

  describe('Logger support', () => {
    it('should use the default logger implementation', async () => {
      const infoSpy = vi.spyOn(console, 'info')
      client = createTestClient({
        log: {
          level: ClickHouseLogLevel.DEBUG,
        },
      })
      expect(infoSpy).toHaveBeenCalledOnce()
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Log level is set to DEBUG'),
      )

      const debugSpy = vi.spyOn(console, 'debug')
      await client.ping()
      expect(debugSpy).toHaveBeenCalledOnce()
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringMatching(/got a response from ClickHouse/),
        expect.stringContaining('\nArguments:'),
        expect.objectContaining({
          request_method: 'GET',
          request_path: '/ping',
          response_status: 200,
        }),
      )
    })

    it('should provide a custom logger implementation', async () => {
      client = createTestClient({
        log: {
          level: ClickHouseLogLevel.DEBUG,
          LoggerClass: TestLogger,
        },
      })
      await client.ping()
      // logs[0] are about the current log level
      expect(logs[1]).toEqual(
        expect.objectContaining({
          message: expect.stringMatching(/got a response from ClickHouse/),
          args: expect.objectContaining({
            request_path: '/ping',
            request_method: 'GET',
          }),
        }),
      )
    })

    it('should provide a custom logger implementation (but logs are disabled)', async () => {
      client = createTestClient({
        log: {
          // the default level is OFF
          LoggerClass: TestLogger,
        },
      })
      await client.ping()
      expect(logs.length).toEqual(0)
    })
  })

  it('should not log unredacted and params on error', async () => {
    client = createTestClient({
      url: 'http://localhost:1', // Invalid URL to trigger errors
      log: {
        level: ClickHouseLogLevel.TRACE,
        LoggerClass: TestLogger,
      },
    })

    const secret = 'D75B76DF-C61F-4A8F-8569-829D0BFC4F1D'

    // Perform an operation that is expected to include a query in the request URL.
    await expect(
      client.exec({
        query: `SELECT '${secret}'`, // Invalid query to trigger an error
        query_params: { secret },
      }),
    ).rejects.toThrow() // We expect this to fail since the query is invalid, but we want to check the logs
    for (const entry of logs) {
      expect(entry.message).not.toContain(secret)
      if (entry.args != null) {
        const serializedArgs = JSON.stringify(entry.args)
        expect(serializedArgs).not.toContain(secret)
      }
    }
  })

  it('should not log unredacted and params on success', async () => {
    const secret = 'D75B76DF-C61F-4A8F-8569-829D0BFC4F1D'

    client = createTestClient({
      http_headers: {
        'X-Test-Header': secret,
      },
      log: {
        level: ClickHouseLogLevel.TRACE,
        LoggerClass: TestLogger,
      },
    })

    // Perform an operation that is expected to include a query in the request URL.
    await client.exec({
      query: `SELECT '${secret}'`,
      query_params: { secret },
    })

    for (const entry of logs) {
      expect(entry.message).not.toContain(secret)
      if (entry.args != null) {
        const serializedArgs = JSON.stringify(entry.args)
        expect(serializedArgs).not.toContain(secret)
      }
    }
  })

  class TestLogger implements Logger {
    trace(params: LogParams) {
      logs.push(params)
    }
    debug(params: LogParams) {
      logs.push(params)
    }
    info(params: LogParams) {
      logs.push(params)
    }
    warn(params: LogParams) {
      logs.push(params)
    }
    error(params: ErrorLogParams) {
      logs.push(params)
    }
  }
})
