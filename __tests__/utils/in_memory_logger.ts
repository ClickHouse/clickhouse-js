import { type Logger } from '../../src'

export class InMemoryLogger implements Logger {
  private readonly messages: string[] = []

  constructor(readonly enabled: boolean) {}

  debug(message: string) {
    this.messages.push(message)
  }

  info(message: string) {
    this.messages.push(message)
  }

  warning(message: string) {
    this.messages.push(message)
  }

  error(message: string): void {
    this.messages.push(message)
  }

  getAll() {
    return this.messages
  }
}
