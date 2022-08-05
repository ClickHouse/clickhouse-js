import { type Logger } from '../../src';

export class DummyLogger implements Logger {
  constructor(readonly enabled: boolean) {}
  debug() {
    /** stub */
  }
  info() {
    /** stub */
  }
  warning() {
    /** stub */
  }
  error() {
    /** stub */
  }
}
