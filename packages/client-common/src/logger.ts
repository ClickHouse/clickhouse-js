/* eslint-disable no-console */
export interface LogParams {
  module: string
  message: string
  args?: Record<string, unknown>
}
export type ErrorLogParams = LogParams & { err: Error }
export type WarnLogParams = LogParams & { err?: Error }
export interface Logger {
  trace(params: LogParams): void
  debug(params: LogParams): void
  info(params: LogParams): void
  warn(params: WarnLogParams): void
  error(params: ErrorLogParams): void
}

export class DefaultLogger implements Logger {
  trace({ module, message, args }: LogParams): void {
    const params: unknown[] = [
      formatMessage({ module, message, level: 'TRACE' }),
    ]
    if (args) {
      params.push('Arguments:', args)
    }
    console.debug(...params)
  }

  debug({ module, message, args }: LogParams): void {
    const params: unknown[] = [
      formatMessage({ module, message, level: 'DEBUG' }),
    ]
    if (args) {
      params.push('Arguments:', args)
    }
    console.debug(...params)
  }

  info({ module, message, args }: LogParams): void {
    const params: unknown[] = [
      formatMessage({ module, message, level: 'INFO' }),
    ]
    if (args) {
      params.push('Arguments:', args)
    }
    console.info(...params)
  }

  warn({ module, message, args, err }: WarnLogParams): void {
    const params: unknown[] = [
      formatMessage({ module, message, level: 'WARN' }),
    ]
    if (args) {
      params.push('Arguments:', args)
    }
    if (err) {
      params.push('Caused by:', err)
    }
    console.warn(...params)
  }

  error({ module, message, args, err }: ErrorLogParams): void {
    const params: unknown[] = [
      formatMessage({ module, message, level: 'ERROR' }),
    ]
    if (args) {
      params.push('Arguments:', args)
    }
    params.push('Caused by:', err)
    console.error(...params)
  }
}

export type LogWriterParams<Method extends keyof Logger> = Omit<
  Parameters<Logger[Method]>[0],
  'module'
> & { module?: string }

export class LogWriter {
  private readonly logLevel: ClickHouseLogLevel
  constructor(
    private readonly logger: Logger,
    private readonly module: string,
    logLevel?: ClickHouseLogLevel,
  ) {
    this.logLevel = logLevel ?? ClickHouseLogLevel.OFF
    this.info({
      message: `Log level is set to ${ClickHouseLogLevel[this.logLevel]}`,
    })
  }

  trace(params: LogWriterParams<'trace'>): void {
    if (this.logLevel <= (ClickHouseLogLevel.TRACE as number)) {
      this.logger.trace({
        ...params,
        module: params.module ?? this.module,
      })
    }
  }

  debug(params: LogWriterParams<'debug'>): void {
    if (this.logLevel <= (ClickHouseLogLevel.DEBUG as number)) {
      this.logger.debug({
        ...params,
        module: params.module ?? this.module,
      })
    }
  }

  info(params: LogWriterParams<'info'>): void {
    if (this.logLevel <= (ClickHouseLogLevel.INFO as number)) {
      this.logger.info({
        ...params,
        module: params.module ?? this.module,
      })
    }
  }

  warn(params: LogWriterParams<'warn'>): void {
    if (this.logLevel <= (ClickHouseLogLevel.WARN as number)) {
      this.logger.warn({
        ...params,
        module: params.module ?? this.module,
      })
    }
  }

  error(params: LogWriterParams<'error'>): void {
    if (this.logLevel <= (ClickHouseLogLevel.ERROR as number)) {
      this.logger.error({
        ...params,
        module: params.module ?? this.module,
      })
    }
  }
}

export enum ClickHouseLogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
  OFF = 127,
}

function formatMessage({
  level,
  module,
  message,
}: {
  level: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  module: string
  message: string
}): string {
  const ts = new Date().toISOString()
  return `[${ts}][${level}][@clickhouse/client][${module}] ${message}`
}
