import { Logger } from '../../src'

export class TestLogger implements Logger {
  constructor(readonly enabled: boolean = true) {}
  debug(message: string) {
    console.debug(`[DEBUG] ${message}`)
  }
  info(message: string) {
    console.info(`[INFO] ${message}`)
  }
  warning(message: string) {
    console.warn(`[WARN] ${message}`)
  }
  error(message: string) {
    console.error(`[DEBUG] ${message}`)
  }
}
