import { type ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient } from '../utils'

describe('config', () => {
  let client: ClickHouseClient
  // let logs: {
  //   message: string
  //   err?: Error
  //   args?: Record<string, unknown>
  //   module?: string
  // }[] = []

  afterEach(async () => {
    await client.close()
    // logs = []
  })

  it('should set request timeout with "request_timeout" setting', async () => {
    client = createTestClient({
      request_timeout: 100,
    })

    await expectAsync(
      client.query({
        query: 'SELECT sleep(3)',
      })
    ).toBeRejectedWith(
      jasmine.objectContaining({
        message: jasmine.stringMatching('Request timed out'),
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

  // describe('Logger support', () => {
  //   const logLevelKey = 'CLICKHOUSE_LOG_LEVEL'
  //   let defaultLogLevel: string | undefined
  //   beforeEach(() => {
  //     defaultLogLevel = process.env[logLevelKey]
  //   })
  //   afterEach(() => {
  //     if (defaultLogLevel === undefined) {
  //       delete process.env[logLevelKey]
  //     } else {
  //       process.env[logLevelKey] = defaultLogLevel
  //     }
  //   })
  //
  //   it('should use the default logger implementation', async () => {
  //     process.env[logLevelKey] = 'DEBUG'
  //     client = createTestClient()
  //     const consoleSpy = spyOn(console, 'debug')
  //     await client.ping()
  //     // logs[0] are about current log level
  //     expect(consoleSpy).toHaveBeenCalledOnceWith(
  //       jasmine.stringContaining('Got a response from ClickHouse'),
  //       jasmine.objectContaining({
  //         request_headers: {
  //           'user-agent': jasmine.any(String),
  //         },
  //         request_method: 'GET',
  //         request_params: '',
  //         request_path: '/ping',
  //         response_headers: jasmine.objectContaining({
  //           connection: jasmine.stringMatching(/Keep-Alive/i),
  //           'content-type': 'text/html; charset=UTF-8',
  //           'transfer-encoding': 'chunked',
  //         }),
  //         response_status: 200,
  //       })
  //     )
  //     expect(consoleSpy).toHaveBeenCalledTimes(1)
  //   })
  //
  //   it('should provide a custom logger implementation', async () => {
  //     process.env[logLevelKey] = 'DEBUG'
  //     client = createTestClient({
  //       log: {
  //         // enable: true,
  //         LoggerClass: TestLogger,
  //       },
  //     })
  //     await client.ping()
  //     // logs[0] are about current log level
  //     expect(logs[1]).toEqual({
  //       module: 'HTTP Adapter',
  //       message: 'Got a response from ClickHouse',
  //       args: jasmine.objectContaining({
  //         request_path: '/ping',
  //         request_method: 'GET',
  //       }),
  //     })
  //   })

  //   it('should provide a custom logger implementation (but logs are disabled)', async () => {
  //     process.env[logLevelKey] = 'OFF'
  //     client = createTestClient({
  //       log: {
  //         // enable: false,
  //         LoggerClass: TestLogger,
  //       },
  //     })
  //     await client.ping()
  //     expect(logs.length).toEqual(0)
  //   })
  // })

  // class TestLogger implements Logger {
  //   debug(params: LogParams) {
  //     logs.push(params)
  //   }
  //   info(params: LogParams) {
  //     logs.push(params)
  //   }
  //   warn(params: LogParams) {
  //     logs.push(params)
  //   }
  //   error(params: ErrorLogParams) {
  //     logs.push(params)
  //   }
  // }
})
