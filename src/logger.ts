export class Logger {
  constructor(readonly enabled = false) {}

  debug(message: string): void {
    if (!this.enabled) return;
    console.log(message);
  }

  info(message: string): void {
    if (!this.enabled) return;
    console.log(message);
  }

  warning(message: string): void {
    if (!this.enabled) return;
    console.warn(message);
  }

  error(message: string): void {
    if (!this.enabled) return;
    console.error(message);
  }
}
