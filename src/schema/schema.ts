import type { Shape } from './common'

export class Schema<S extends Shape> {
  constructor(public readonly shape: S) {}

  toString(delimiter?: string): string {
    return Object.entries(this.shape)
      .map(([column, type]) => `${column} ${type.toString()}`)
      .join(delimiter ?? ', ')
  }
}
