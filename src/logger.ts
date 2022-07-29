import Debug from 'debug'

const debug = Debug('clickhouse');

export function log (...args: any[]) : void {
  debug(':', ...args);
}

export function enable (): void {
  Debug.enable('clickhouse');
}

export function disable (): void {
  Debug.disable();
}
