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
          request_headers: {
            connection: expect.stringMatching(/Keep-Alive/i),
            'user-agent': expect.any(String),
          },
          request_method: 'GET',
          request_params: '',
          request_path: '/ping',
          response_headers: expect.objectContaining({
            connection: expect.stringMatching(/Keep-Alive/i),
            'content-type': 'text/html; charset=UTF-8',
            'transfer-encoding': 'chunked',
          }),
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

    it('should redact query parameter from request_params when unsafeLogUnredactedQueries is false', async () => {
      client = createTestClient({
        log: {
          level: ClickHouseLogLevel.DEBUG,
          LoggerClass: TestLogger,
          unsafeLogUnredactedQueries: false,
        },
      })
      // Insert operation sends query as URL parameter
      await client
        .insert({
          table: 'test_table',
          values: [[1, 'test']],
          format: 'JSONEachRow',
        })
        .catch(() => {
          // Ignore errors - we're just testing logging
        })

      // Find the debug log for the response
      const responseLog = logs.find((log) =>
        log.message?.includes('got a response from ClickHouse'),
      )
      expect(responseLog).toBeDefined()
      expect(responseLog?.args?.request_params).toBeDefined()
      // Should not contain the query parameter
      expect(responseLog?.args?.request_params).not.toMatch(/query=/)
    })

    it('should include query parameter in request_params when unsafeLogUnredactedQueries is true', async () => {
      client = createTestClient({
        log: {
          level: ClickHouseLogLevel.DEBUG,
          LoggerClass: TestLogger,
          unsafeLogUnredactedQueries: true,
        },
      })
      // Insert operation sends query as URL parameter
      await client
        .insert({
          table: 'test_table',
          values: [[1, 'test']],
          format: 'JSONEachRow',
        })
        .catch(() => {
          // Ignore errors - we're just testing logging
        })

      // Find the debug log for the response
      const responseLog = logs.find((log) =>
        log.message?.includes('got a response from ClickHouse'),
      )
      expect(responseLog).toBeDefined()
      expect(responseLog?.args?.request_params).toBeDefined()
      // Should contain the query parameter
      expect(responseLog?.args?.request_params).toMatch(/query=/)
    })

    it('should redact query parameter from search_params in error logs when unsafeLogUnredactedQueries is false', async () => {
      client = createTestClient({
        // Use an invalid URL to trigger an error
        url: 'http://localhost:1',
        request_timeout: 100,
        log: {
          level: ClickHouseLogLevel.ERROR,
          LoggerClass: TestLogger,
          unsafeLogUnredactedQueries: false,
        },
      })
      await client
        .insert({
          table: 'test_table',
          values: [[1, 'test']],
          format: 'JSONEachRow',
        })
        .catch(() => {
          // Expected to fail
        })

      // Find the error log
      const errorLog = logs.find((log) =>
        log.message?.includes('HTTP request error'),
      )
      expect(errorLog).toBeDefined()
      // search_params should not contain the query parameter
      if (errorLog?.args?.search_params) {
        expect(errorLog.args.search_params).not.toMatch(/query=/)
      }
    })

    it('should include query parameter in search_params in error logs when unsafeLogUnredactedQueries is true', async () => {
      client = createTestClient({
        // Use an invalid URL to trigger an error
        url: 'http://localhost:1',
        request_timeout: 100,
        log: {
          level: ClickHouseLogLevel.ERROR,
          LoggerClass: TestLogger,
          unsafeLogUnredactedQueries: true,
        },
      })
      await client
        .insert({
          table: 'test_table',
          values: [[1, 'test']],
          format: 'JSONEachRow',
        })
        .catch(() => {
          // Expected to fail
        })

      // Find the error log
      const errorLog = logs.find((log) =>
        log.message?.includes('HTTP request error'),
      )
      expect(errorLog).toBeDefined()
      // search_params should contain the query parameter
      if (errorLog?.args?.search_params) {
        expect(errorLog.args.search_params).toMatch(/query=/)
      }
    })
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
