import type { Logger } from '../../src'

export class TestLogger implements Logger {
  constructor(readonly enabled: boolean = true) {}
  debug(message: string, args?: Record<string, unknown>) {
    if (!this.enabled) return
    console.debug(`[${getTestName()}]\n${message}`, args)
  }
  info(message: string, args?: Record<string, unknown>) {
    if (!this.enabled) return
    console.info(`[${getTestName()}]\n${message}`, args)
  }
  warning(message: string, args?: Record<string, unknown>) {
    if (!this.enabled) return
    console.warn(`[${getTestName()}]\n${message}`, args)
  }
  error(message: string, err: Error, args?: Record<string, unknown>) {
    if (!this.enabled) return
    console.error(`[${getTestName()}]\n${message}`, args, err)
  }
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
