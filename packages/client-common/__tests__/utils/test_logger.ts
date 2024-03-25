import type {
  ErrorLogParams,
  Logger,
  LogParams,
} from '@clickhouse/client-common'

export class TestLogger implements Logger {
  trace({ module, message, args }: LogParams) {
    console.log(formatMessage({ level: 'TRACE', module, message }), args || '')
  }
  debug({ module, message, args }: LogParams) {
    console.log(formatMessage({ level: 'DEBUG', module, message }), args || '')
  }
  info({ module, message, args }: LogParams) {
    console.log(formatMessage({ level: 'INFO', module, message }), args || '')
  }
  warn({ module, message, args }: LogParams) {
    console.log(formatMessage({ level: 'WARN', module, message }), args || '')
  }
  error({ module, message, args, err }: ErrorLogParams) {
    console.error(
      formatMessage({ level: 'ERROR', module, message }),
      args || '',
      err,
    )
  }
}

function formatMessage({
  level,
  module,
  message,
}: {
  level: string
  module: string
  message: string
}): string {
  return `[${level}][${module}] ${message}`
}
