import type { Logger } from '../../src'
import type { ErrorLogParams, LogParams } from '../../src/logger'

export class TestLogger implements Logger {
  debug({ module, message, args }: LogParams) {
    console.debug(formatMessage({ module, message }), args || '')
  }
  info({ module, message, args }: LogParams) {
    console.info(formatMessage({ module, message }), args || '')
  }
  warn({ module, message, args }: LogParams) {
    console.warn(formatMessage({ module, message }), args || '')
  }
  error({ module, message, args, err }: ErrorLogParams) {
    console.error(formatMessage({ module, message }), args || '', err)
  }
}

function formatMessage({
  module,
  message,
}: {
  module: string
  message: string
}): string {
  return `[${module}][${getTestName()}] ${message}`
}

function getTestName() {
  try {
    return expect.getState().currentTestName || 'Unknown'
  } catch (e) {
    // ReferenceError can happen here cause `expect`
    // is not yet available during globalSetup phase,
    // and we are not allowed to import it explicitly
    return 'Global Setup'
  }
}
