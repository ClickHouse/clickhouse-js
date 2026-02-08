import type {
  ClickHouseClient,
  ErrorLogParams,
  Logger,
  LogParams,
} from '@clickhouse/client-common'
import { describe, it, afterEach, expect, vi } from 'vitest'
import { ClickHouseLogLevel } from '@clickhouse/client-common'
import { createTestClient } from '../utils/client.node'

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
        expect.stringContaining('Ping: got a response from ClickHouse'),
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
          message: 'Ping: got a response from ClickHouse',
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
