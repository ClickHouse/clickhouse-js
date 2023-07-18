import type {
  ErrorLogParams,
  Logger,
  LogParams,
} from '@clickhouse/client-common/logger'
import { ClickHouseLogLevel, LogWriter } from '@clickhouse/client-common/logger'

describe('Node.js Logger', () => {
  type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

  const module = 'LoggerUnitTest'
  const message = 'very informative'
  const err = new Error('boo')

  let logs: Array<LogParams & { level: LogLevel; err?: Error }> = []

  afterEach(() => {
    logs = []
  })

  it('should use OFF by default', async () => {
    const logWriter = new LogWriter(new TestLogger())
    logEveryLogLevel(logWriter)
    expect(logs.length).toEqual(0)
  })

  it('should explicitly use TRACE', async () => {
    const logWriter = new LogWriter(new TestLogger(), ClickHouseLogLevel.TRACE)
    checkLogLevelSet('TRACE')
    logEveryLogLevel(logWriter)
    expect(logs[0]).toEqual({
      level: 'trace',
      message,
      module,
    })
    expect(logs[1]).toEqual({
      level: 'debug',
      message,
      module,
    })
    expect(logs[2]).toEqual({
      level: 'info',
      message,
      module,
    })
    expect(logs[3]).toEqual({
      level: 'warn',
      message,
      module,
    })
    expect(logs[4]).toEqual({
      level: 'error',
      message,
      module,
      err,
    })
    expect(logs.length).toEqual(5)
  })

  it('should explicitly use DEBUG', async () => {
    const logWriter = new LogWriter(new TestLogger(), ClickHouseLogLevel.DEBUG)
    checkLogLevelSet('DEBUG')
    logEveryLogLevel(logWriter)
    expect(logs[0]).toEqual({
      level: 'debug',
      message,
      module,
    })
    expect(logs[1]).toEqual({
      level: 'info',
      message,
      module,
    })
    expect(logs[2]).toEqual({
      level: 'warn',
      message,
      module,
    })
    expect(logs[3]).toEqual({
      level: 'error',
      message,
      module,
      err,
    })
    expect(logs.length).toEqual(4)
  })

  it('should explicitly use INFO', async () => {
    const logWriter = new LogWriter(new TestLogger(), ClickHouseLogLevel.INFO)
    checkLogLevelSet('INFO')
    logEveryLogLevel(logWriter)
    expect(logs[0]).toEqual({
      level: 'info',
      message,
      module,
    })
    expect(logs[1]).toEqual({
      level: 'warn',
      message,
      module,
    })
    expect(logs[2]).toEqual({
      level: 'error',
      message,
      module,
      err,
    })
    expect(logs.length).toEqual(3)
  })

  it('should explicitly use WARN', async () => {
    const logWriter = new LogWriter(new TestLogger(), ClickHouseLogLevel.WARN)
    logEveryLogLevel(logWriter)
    expect(logs[0]).toEqual({
      level: 'warn',
      message,
      module,
    })
    expect(logs[1]).toEqual({
      level: 'error',
      message,
      module,
      err,
    })
    expect(logs.length).toEqual(2)
  })

  it('should explicitly use ERROR', async () => {
    const logWriter = new LogWriter(new TestLogger(), ClickHouseLogLevel.ERROR)
    logEveryLogLevel(logWriter)
    expect(logs[0]).toEqual({
      level: 'error',
      message,
      module,
      err,
    })
    expect(logs.length).toEqual(1)
  })

  function checkLogLevelSet(level: string) {
    expect(logs).toEqual([
      {
        level: 'info',
        module: 'Logger',
        message: `Log level is set to ${level}`,
      },
    ])
    logs = []
  }

  function logEveryLogLevel(logWriter: LogWriter) {
    for (const level of ['trace', 'debug', 'info', 'warn']) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      logWriter[level]({
        module,
        message,
      })
    }
    logWriter.error({
      module,
      message,
      err,
    })
  }

  class TestLogger implements Logger {
    trace(params: LogParams) {
      logs.push({ ...params, level: 'trace' })
    }
    debug(params: LogParams) {
      logs.push({ ...params, level: 'debug' })
    }
    info(params: LogParams) {
      logs.push({ ...params, level: 'info' })
    }
    warn(params: LogParams) {
      logs.push({ ...params, level: 'warn' })
    }
    error(params: ErrorLogParams) {
      logs.push({ ...params, level: 'error' })
    }
  }
})
