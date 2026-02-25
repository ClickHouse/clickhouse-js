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
      params.push('\nArguments:', args)
    }
    console.debug(...params)
  }

  debug({ module, message, args }: LogParams): void {
    const params: unknown[] = [
      formatMessage({ module, message, level: 'DEBUG' }),
    ]
    if (args) {
      params.push('\nArguments:', args)
    }
    console.debug(...params)
  }

  info({ module, message, args }: LogParams): void {
    const params: unknown[] = [
      formatMessage({ module, message, level: 'INFO' }),
    ]
    if (args) {
      params.push('\nArguments:', args)
    }
    console.info(...params)
  }

  warn({ module, message, args, err }: WarnLogParams): void {
    const params: unknown[] = [
      formatMessage({ module, message, level: 'WARN' }),
    ]
    if (args) {
      params.push('\nArguments:', args)
    }
    if (err) {
      params.push('\nCaused by:', err)
    }
    console.warn(...params)
  }

  error({ module, message, args, err }: ErrorLogParams): void {
    const params: unknown[] = [
      formatMessage({ module, message, level: 'ERROR' }),
    ]
    if (args) {
      params.push('\nArguments:', args)
    }
    params.push('\nCaused by:', err)
    console.error(...params)
  }
}

export type LogWriterParams<Method extends keyof Logger> = Omit<
  Parameters<Logger[Method]>[0],
  'module'
> & { module?: string }

export class LogWriter {
  constructor(
    private readonly logger: Logger,
    private readonly module: string,
    private readonly logLevel: ClickHouseLogLevel,
  ) {
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
  /**
   * A fine-grained debugging event. Might produce a lot of logs, so use with caution.
   */
  TRACE = 0,
  /**
   * A debugging event. Useful for debugging, but generally not needed in production. Includes technical values that might require redacting.
   */
  DEBUG = 1,
  /**
   * An informational event. Indicates that an event happened.
   */
  INFO = 2,
  /**
   * A warning event. Not an error, but is likely more important than an informational event. Addressing should help prevent potential issues.
   */
  WARN = 3,
  /**
   * An error event. Something went wrong.
   */
  ERROR = 4,
  /**
   * Logging is turned off.
   */
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
