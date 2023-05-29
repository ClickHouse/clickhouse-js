import type { NonEmptyArray, Shape } from './common'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface WhereExpr<S extends Shape> {
  toString(): string
  type: 'And' | 'Or' | 'Eq' | 'Le' | 'Lte' | 'Gt' | 'Gte'
}

export function Eq<S extends Shape, F extends keyof S>(
  field: F,
  value: S[F]['underlying']
): WhereExpr<S> {
  return {
    toString(): string {
      return `(${String(field)} == ${formatValue(value)})`
    },
    type: 'Eq',
  }
}
export function And<S extends Shape>(
  ...expr: NonEmptyArray<WhereExpr<S>>
): WhereExpr<S> {
  return {
    toString(): string {
      return `(${expr.join(' AND ')})`
    },
    type: 'And',
  }
}
export function Or<S extends Shape>(
  ...expr: NonEmptyArray<WhereExpr<S>>
): WhereExpr<S> {
  return {
    toString(): string {
      return `(${expr.join(' OR ')})`
    },
    type: 'Or',
  }
}

function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return 'NULL'
  }
  if (typeof value === 'string') {
    return `'${value}'`
  }
  if (globalThis.Array.isArray(value)) {
    return `[${value.join(', ')}]`
  }
  return value.toString()
}
