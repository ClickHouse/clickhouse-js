import {
  ClickHouseLogLevel,
  DefaultLogger,
  LogWriter,
} from '@clickhouse/client-common'

describe('[Node.js] Logger/LogWriter', () => {
  type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

  const module = 'LoggerTest'
  const message = 'very informative'
  const err = new Error('boo')

  let debugSpy: jasmine.Spy
  let infoSpy: jasmine.Spy
  let warnSpy: jasmine.Spy
  let errSpy: jasmine.Spy

  beforeEach(() => {
    debugSpy = spyOn(console, 'debug')
    infoSpy = spyOn(console, 'info')
    warnSpy = spyOn(console, 'warn')
    errSpy = spyOn(console, 'error')
  })

  it('should use OFF by default', async () => {
    const logWriter = new LogWriter(new DefaultLogger(), module)
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
    expect(infoSpy.calls.first().args).toEqual([
      jasmine.stringContaining(
        `[INFO][@clickhouse/client][${module}] Log level is set to ${level}`,
      ),
    ])
    expect(infoSpy).toHaveBeenCalledTimes(1)
  }

  function checkLog(spy: jasmine.Spy, level: LogLevel, callNumber: number = 0) {
    expect(spy.calls.all()[callNumber].args).toEqual([
      jasmine.stringContaining(
        `[${level}][@clickhouse/client][${module}] ${message}`,
      ),
      jasmine.stringContaining('\nArguments:'),
      { foo: `${level.toLowerCase()}-42` },
    ])
  }

  function checkErrorLog() {
    expect(errSpy.calls.first().args).toEqual([
      jasmine.stringContaining(
        `[ERROR][@clickhouse/client][${module}] ${message}`,
      ),
      jasmine.stringContaining('\nArguments:'),
      { foo: 'err-42' },
      jasmine.stringContaining('\nCaused by:'),
      err,
    ])
  }

  function logEveryLogLevel(logWriter: LogWriter) {
    for (const level of ['trace', 'debug', 'info', 'warn']) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
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
