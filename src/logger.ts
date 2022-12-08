export interface LogParams {
  module: string
  message: string
  args?: Record<string, unknown>
}
export type ErrorLogParams = LogParams & { err: Error }
export interface Logger {
  debug(params: LogParams): void
  info(params: LogParams): void
  warn(params: LogParams): void
  error(params: ErrorLogParams): void
}

export class DefaultLogger implements Logger {
  debug({ module, message, args }: LogParams): void {
    console.debug(formatMessage({ module, message }), args)
  }

  info({ module, message, args }: LogParams): void {
    console.info(formatMessage({ module, message }), args)
  }

  warn({ module, message, args }: LogParams): void {
    console.warn(formatMessage({ module, message }), args)
  }

  error({ module, message, args, err }: ErrorLogParams): void {
    console.error(formatMessage({ module, message }), args, err)
  }
}
export class LogWriter {
  private readonly logLevel: ClickHouseLogLevel
  constructor(private readonly logger: Logger) {
    this.logLevel = this.getClickHouseLogLevel()
    this.info({
      module: 'Logger',
      message: `Log level is set to ${ClickHouseLogLevel[this.logLevel]}`,
    })
  }

  debug(params: LogParams): void {
    if (this.logLevel <= (ClickHouseLogLevel.DEBUG as number)) {
      this.logger.debug(params)
    }
  }

  info(params: LogParams): void {
    if (this.logLevel <= (ClickHouseLogLevel.INFO as number)) {
      this.logger.info(params)
    }
  }

  warn(params: LogParams): void {
    if (this.logLevel <= (ClickHouseLogLevel.WARN as number)) {
      this.logger.warn(params)
    }
  }

  error(params: ErrorLogParams): void {
    if (this.logLevel <= (ClickHouseLogLevel.ERROR as number)) {
      this.logger.error(params)
    }
  }

  private getClickHouseLogLevel(): ClickHouseLogLevel {
    const logLevelFromEnv = process.env['CLICKHOUSE_LOG_LEVEL']
    if (!logLevelFromEnv) {
      return ClickHouseLogLevel.OFF
    }
    const logLevel = logLevelFromEnv.toLocaleLowerCase()
    if (logLevel === 'info') {
      return ClickHouseLogLevel.INFO
    }
    if (logLevel === 'warn') {
      return ClickHouseLogLevel.WARN
    }
    if (logLevel === 'error') {
      return ClickHouseLogLevel.ERROR
    }
    if (logLevel === 'debug') {
      return ClickHouseLogLevel.DEBUG
    }
    if (logLevel === 'trace') {
      return ClickHouseLogLevel.TRACE
    }
    if (logLevel === 'off') {
      return ClickHouseLogLevel.OFF
    }
    console.error(
      `Unknown CLICKHOUSE_LOG_LEVEL value: ${logLevelFromEnv}, logs are disabled`
    )
    return ClickHouseLogLevel.OFF
  }
}

enum ClickHouseLogLevel {
  TRACE = 0, // unused at the moment
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
  OFF = 127,
}

function formatMessage({
  module,
  message,
}: {
  module: string
  message: string
}): string {
  return `[@clickhouse/client][${module}] ${message}`
}
