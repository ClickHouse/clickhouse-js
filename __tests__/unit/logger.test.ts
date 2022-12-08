import type { ErrorLogParams, Logger, LogParams } from '../../src/logger'
import { LogWriter } from '../../src/logger'

describe('Logger', () => {
  type LogLevel = 'debug' | 'info' | 'warn' | 'error'

  const logLevelKey = 'CLICKHOUSE_LOG_LEVEL'
  const module = 'LoggerUnitTest'
  const message = 'very informative'
  const err = new Error('boo')

  let logs: Array<LogParams & { level: LogLevel }> = []
  let defaultLogLevel: string | undefined

  beforeEach(() => {
    defaultLogLevel = process.env[logLevelKey]
  })
  afterEach(() => {
    if (defaultLogLevel === undefined) {
      delete process.env[logLevelKey]
    } else {
      process.env[logLevelKey] = defaultLogLevel
    }
    logs = []
  })

  it('should use OFF by default', async () => {
    const logWriter = new LogWriter(new TestLogger())
    logEveryLogLevel(logWriter)
    expect(logs.length).toEqual(0)
  })

  it('should explicitly use DEBUG', async () => {
    process.env[logLevelKey] = 'DEBUG'
    const logWriter = new LogWriter(new TestLogger())
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
    process.env[logLevelKey] = 'INFO'
    const logWriter = new LogWriter(new TestLogger())
    checkLogLevelSet('INFO')
    logEveryLogLevel(logWriter)
    checkInfoLogs()
  })

  it('should explicitly use WARN', async () => {
    process.env[logLevelKey] = 'WARN'
    const logWriter = new LogWriter(new TestLogger())
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
    process.env[logLevelKey] = 'ERROR'
    const logWriter = new LogWriter(new TestLogger())
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
    for (const level of ['debug', 'info', 'warn']) {
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

  function checkInfoLogs() {
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
  }

  class TestLogger implements Logger {
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
