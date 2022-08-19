import type { Type } from './types'

// TODO: TTL
// TODO: Materialized columns
// TODO: alias
export type Shape = {
  [key: string]: Type
}

export type Infer<S extends Shape> = {
  [Field in keyof S]: S[Field]['underlying']
}

export type NonEmptyArray<T> = [T, ...T[]]
