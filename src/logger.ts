export class Logger {
  constructor(readonly enabled = false) {}

  debug(message: string, args?: Record<string, unknown>): void {
    if (!this.enabled) return
    console.debug(message, args)
  }

  info(message: string, args?: Record<string, unknown>): void {
    if (!this.enabled) return
    console.info(message, args)
  }

  warning(message: string, args?: Record<string, unknown>): void {
    if (!this.enabled) return
    console.warn(message, args)
  }

  error(message: string, err: Error, args?: Record<string, unknown>): void {
    if (!this.enabled) return
    console.error(message, args, err)
  }
}
