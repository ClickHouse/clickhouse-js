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
    if (this.logLevel < (ClickHouseLogLevel.INFO as number)) {
      this.logger.debug(params)
    }
  }

  info(params: LogParams): void {
    if (this.logLevel < (ClickHouseLogLevel.WARN as number)) {
      this.logger.info(params)
    }
  }

  warn(params: LogParams): void {
    if (this.logLevel < (ClickHouseLogLevel.ERROR as number)) {
      this.logger.info(params)
    }
  }

  error(params: ErrorLogParams): void {
    if (this.logLevel < (ClickHouseLogLevel.OFF as number)) {
      this.logger.info(params)
    }
  }

  private getClickHouseLogLevel(): ClickHouseLogLevel {
    const fromEnv = process.env['CLICKHOUSE_LOG_LEVEL']
    if (!fromEnv) {
      return ClickHouseLogLevel.INFO
    }
    const lower = fromEnv.toLocaleLowerCase()
    if (lower === 'info') {
      return ClickHouseLogLevel.INFO
    }
    if (lower === 'warn') {
      return ClickHouseLogLevel.WARN
    }
    if (lower === 'error') {
      return ClickHouseLogLevel.ERROR
    }
    if (lower === 'debug') {
      return ClickHouseLogLevel.DEBUG
    }
    if (lower === 'trace') {
      return ClickHouseLogLevel.TRACE
    }
    if (lower === 'off') {
      return ClickHouseLogLevel.OFF
    }
    console.error(
      `Unknown CLICKHOUSE_LOG_LEVEL value: ${fromEnv}, defaulting to INFO`
    )
    return ClickHouseLogLevel.INFO
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
