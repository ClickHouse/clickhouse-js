export interface LogParams {
  module: string
  message: string
  args?: Record<string, unknown>
}
export type ErrorLogParams = LogParams & { err: Error }
export interface Logger {
  trace(params: LogParams): void
  debug(params: LogParams): void
  info(params: LogParams): void
  warn(params: LogParams): void
  error(params: ErrorLogParams): void
}

export class DefaultLogger implements Logger {
  trace({ module, message, args }: LogParams): void {
    console.trace(formatMessage({ module, message }), args)
  }

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

export type LogWriterParams = Omit<LogParams, 'module'> & { module?: string }
export type LogWriterErrorParams = Omit<ErrorLogParams, 'module'> & {
  module?: string
}

export class LogWriter {
  private readonly logLevel: ClickHouseLogLevel
  constructor(
    private readonly logger: Logger,
    private readonly module: string,
    logLevel?: ClickHouseLogLevel
  ) {
    this.logLevel = logLevel ?? ClickHouseLogLevel.OFF
    this.info({
      module: 'Logger',
      message: `Log level is set to ${ClickHouseLogLevel[this.logLevel]}`,
    })
  }

  trace(params: LogWriterParams): void {
    if (this.logLevel <= (ClickHouseLogLevel.TRACE as number)) {
      this.logger.trace({
        ...params,
        module: params.module ?? this.module,
      })
    }
  }

  debug(params: LogWriterParams): void {
    if (this.logLevel <= (ClickHouseLogLevel.DEBUG as number)) {
      this.logger.debug({
        ...params,
        module: params.module ?? this.module,
      })
    }
  }

  info(params: LogWriterParams): void {
    if (this.logLevel <= (ClickHouseLogLevel.INFO as number)) {
      this.logger.info({
        ...params,
        module: params.module ?? this.module,
      })
    }
  }

  warn(params: LogWriterParams): void {
    if (this.logLevel <= (ClickHouseLogLevel.WARN as number)) {
      this.logger.warn({
        ...params,
        module: params.module ?? this.module,
      })
    }
  }

  error(params: LogWriterErrorParams): void {
    if (this.logLevel <= (ClickHouseLogLevel.ERROR as number)) {
      this.logger.error({
        ...params,
        module: params.module ?? this.module,
      })
    }
  }
}

export enum ClickHouseLogLevel {
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
