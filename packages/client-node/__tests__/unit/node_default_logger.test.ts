import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ClickHouseLogLevel,
  DefaultLogger,
  LogWriter,
} from '@clickhouse/client-common'

beforeEach(() => {
  vi.clearAllMocks()
})

const debugSpy = vi.spyOn(console, 'debug')
const infoSpy = vi.spyOn(console, 'info')
const warnSpy = vi.spyOn(console, 'warn')
const errSpy = vi.spyOn(console, 'error')

describe('[Node.js] Logger/LogWriter', () => {
  type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

  const module = 'LoggerTest'
  const message = 'very informative'
  const err = new Error('boo')

  it('should explicitly use OFF', async () => {
    const logWriter = new LogWriter(
      new DefaultLogger(),
      module,
      ClickHouseLogLevel.OFF,
    )
    logEveryLogLevel(logWriter)
    expect(debugSpy).toHaveBeenCalledTimes(0)
    expect(infoSpy).toHaveBeenCalledTimes(0)
    expect(warnSpy).toHaveBeenCalledTimes(0)
    expect(errSpy).toHaveBeenCalledTimes(0)
  })

  it('should explicitly use TRACE', async () => {
    const logWriter = new LogWriter(
      new DefaultLogger(),
      module,
      ClickHouseLogLevel.TRACE,
    )

    checkLogLevelSet('TRACE')
    logEveryLogLevel(logWriter)

    // TRACE + DEBUG
    expect(debugSpy).toHaveBeenCalledTimes(2)
    checkLog(debugSpy, 'TRACE', 0)
    checkLog(debugSpy, 'DEBUG', 1)

    // + set log level call
    expect(infoSpy).toHaveBeenCalledTimes(2)
    checkLog(infoSpy, 'INFO', 1)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    checkLog(warnSpy, 'WARN')

    expect(errSpy).toHaveBeenCalledTimes(1)
    checkErrorLog()
  })

  it('should explicitly use DEBUG', async () => {
    const logWriter = new LogWriter(
      new DefaultLogger(),
      module,
      ClickHouseLogLevel.DEBUG,
    )

    checkLogLevelSet('DEBUG')
    logEveryLogLevel(logWriter)

    // No TRACE, only DEBUG
    expect(debugSpy).toHaveBeenCalledTimes(1)
    checkLog(debugSpy, 'DEBUG', 0)

    // + set log level call
    expect(infoSpy).toHaveBeenCalledTimes(2)
    checkLog(infoSpy, 'INFO', 1)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    checkLog(warnSpy, 'WARN')

    expect(errSpy).toHaveBeenCalledTimes(1)
    checkErrorLog()
  })

  it('should explicitly use INFO', async () => {
    const logWriter = new LogWriter(
      new DefaultLogger(),
      module,
      ClickHouseLogLevel.INFO,
    )

    checkLogLevelSet('INFO')
    logEveryLogLevel(logWriter)

    // No TRACE or DEBUG logs
    expect(debugSpy).toHaveBeenCalledTimes(0)

    // + set log level call
    expect(infoSpy).toHaveBeenCalledTimes(2)
    checkLog(infoSpy, 'INFO', 1)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    checkLog(warnSpy, 'WARN')

    expect(errSpy).toHaveBeenCalledTimes(1)
    checkErrorLog()
  })

  it('should explicitly use WARN', async () => {
    const logWriter = new LogWriter(
      new DefaultLogger(),
      module,
      ClickHouseLogLevel.WARN,
    )

    logEveryLogLevel(logWriter)

    // No TRACE, DEBUG, or INFO logs
    expect(debugSpy).toHaveBeenCalledTimes(0)
    expect(infoSpy).toHaveBeenCalledTimes(0)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    checkLog(warnSpy, 'WARN')

    expect(errSpy).toHaveBeenCalledTimes(1)
    checkErrorLog()
  })

  it('should explicitly use WARN', async () => {
    const logWriter = new LogWriter(
      new DefaultLogger(),
      module,
      ClickHouseLogLevel.ERROR,
    )

    logEveryLogLevel(logWriter)

    // No TRACE, DEBUG, INFO, or WARN logs
    expect(debugSpy).toHaveBeenCalledTimes(0)
    expect(infoSpy).toHaveBeenCalledTimes(0)
    expect(warnSpy).toHaveBeenCalledTimes(0)

    expect(errSpy).toHaveBeenCalledTimes(1)
    checkErrorLog()
  })

  function checkLogLevelSet(level: LogLevel) {
    expect(infoSpy.mock.calls[0]).toEqual([
      expect.stringContaining(
        `[INFO][@clickhouse/client][${module}] Log level is set to ${level}`,
      ),
    ])
    expect(infoSpy).toHaveBeenCalledTimes(1)
  }

  function checkLog(spy: any, level: LogLevel, callNumber = 0) {
    expect(spy.mock.calls[callNumber]).toEqual([
      expect.stringContaining(
        `[${level}][@clickhouse/client][${module}] ${message}`,
      ),
      expect.stringContaining('\nArguments:'),
      { foo: `${level.toLowerCase()}-42` },
    ])
  }

  function checkErrorLog() {
    expect(errSpy.mock.calls[0]).toEqual([
      expect.stringContaining(
        `[ERROR][@clickhouse/client][${module}] ${message}`,
      ),
      expect.stringContaining('\nArguments:'),
      { foo: 'err-42' },
      expect.stringContaining('\nCaused by:'),
      err,
    ])
  }

  function logEveryLogLevel(logWriter: LogWriter) {
    for (const level of ['trace', 'debug', 'info', 'warn']) {
      // @ts-ignore
      logWriter[level]({
        message,
        args: {
          foo: `${level}-42`,
        },
      })
    }
    logWriter.error({
      message,
      err,
      args: {
        foo: 'err-42',
      },
    })
  }
})
