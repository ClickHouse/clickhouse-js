import {
  ClickHouseClient,
  ClickHouseLogLevel,
  ErrorLogParams,
  Logger,
  LogParams,
} from '@clickhouse/client-common'
import { createTestClient } from '@test/utils'

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
      const infoSpy = spyOn(console, 'info')
      client = createTestClient({
        log: {
          level: ClickHouseLogLevel.DEBUG,
        },
      })
      expect(infoSpy).toHaveBeenCalledOnceWith(
        jasmine.stringContaining('Log level is set to DEBUG'),
      )

      const debugSpy = spyOn(console, 'debug')
      await client.ping()
      expect(debugSpy).toHaveBeenCalledOnceWith(
        jasmine.stringContaining('Ping: got a response from ClickHouse'),
        jasmine.stringContaining('\nArguments:'),
        jasmine.objectContaining({
          request_headers: {
            connection: jasmine.stringMatching(/Keep-Alive/i),
            'user-agent': jasmine.any(String),
          },
          request_method: 'GET',
          request_params: '',
          request_path: '/ping',
          response_headers: jasmine.objectContaining({
            connection: jasmine.stringMatching(/Keep-Alive/i),
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
      // logs[0] are about current log level
      expect(logs[1]).toEqual(
        jasmine.objectContaining({
          message: 'Ping: got a response from ClickHouse',
          args: jasmine.objectContaining({
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
