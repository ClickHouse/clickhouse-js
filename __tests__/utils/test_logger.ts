import type { Logger } from '../../src'

export class TestLogger implements Logger {
  constructor(readonly enabled: boolean = true) {}
  debug(message: string) {
    if (!this.enabled) return
    console.debug(`[DEBUG] ${message}`)
  }
  info(message: string) {
    if (!this.enabled) return
    console.info(`[INFO] ${message}`)
  }
  warning(message: string) {
    if (!this.enabled) return
    console.warn(`[WARN] ${message}`)
  }
  error(message: string) {
    if (!this.enabled) return
    console.error(`[DEBUG] ${message}`)
  }
}
