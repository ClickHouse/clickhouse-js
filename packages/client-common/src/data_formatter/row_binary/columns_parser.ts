import { ClickHouseRowBinaryError } from './errors'
import type { SimpleColumnType } from './types'
import { RowBinarySimpleDecoders } from './types'

export interface ParsedColumnSimple {
  type: 'Simple'
  /** Without LowCardinality and Nullable. For example:
   *  * UInt8 -> UInt8
   *  * LowCardinality(Nullable(String)) -> String */
  columnType: SimpleColumnType
  dbType: string
}

export type ParsedColumnNullable =
  | {
      type: 'Nullable'
      /** Used to determine how to decode T from Nullable(T) */
      valueType: SimpleColumnType
      dbType: string
    }
  | {
      type: 'Nullable'
      valueType: 'Decimal'
      decimalParams: ParsedColumnDecimal['params']
      dbType: string
    }
  | {
      type: 'Nullable'
      valueType: 'Enum'
      values: ParsedColumnEnum['values']
      intSize: ParsedColumnEnum['intSize']
      dbType: string
    }

export interface ParsedColumnEnum {
  type: 'Enum'
  values: Map<number, string>
  intSize: 8 | 16
  dbType: string
}

export interface ParseColumnTuple {
  type: 'Tuple'
  elements: ParsedColumnType[]
  dbType: string
}

/** Int size for Decimal depends on the Precision
 *  * 32 bits  for precision <  10 (JS number)
 *  * 64 bits  for precision <  19 (JS BigInt)
 *  * 128 bits for precision <  39 (JS BigInt)
 *  * 256 bits for precision >= 39 (JS BigInt)
 */
export interface DecimalParams {
  precision: number
  scale: number
  intSize: 32 | 64 | 128 | 256
}
export interface ParsedColumnDecimal {
  type: 'Decimal'
  params: DecimalParams
  dbType: string
}

/** Array cannot be Nullable or LowCardinality, but its value type can be.
 *  Arrays can be multidimensional, e.g. Array(Array(Array(T))).
 *  Arrays are allowed to have a Map as the value type.
 */
export type ParsedColumnArray =
  | {
      type: 'Array'
      dimensions: number
      /** Represents the final value type; nested arrays are handled with {@link ParsedColumnArray.dimensions} */
      valueType: SimpleColumnType
      valueNullable: boolean
      dbType: string
    }
  | {
      type: 'Array'
      dimensions: number
      valueType: 'Decimal'
      valueNullable: boolean
      decimalParams: DecimalParams
      dbType: string
    }

// export interface ParsedColumnMap {
//   type: 'Map'
//   key: ParsedColumnSimple
//   value: ParsedColumnSimple | ParsedColumnArray | ParsedColumnMap
//   dbType: string
// } // TODO - add Map support.

export type ParsedColumnType =
  | ParsedColumnSimple
  | ParsedColumnNullable
  | ParsedColumnDecimal
  | ParsedColumnArray
  | ParsedColumnEnum
// | ParsedColumnMap  // TODO - add Map support.

export function parseColumnType(dbType: string): ParsedColumnType {
  let columnType = dbType
  let isNullable = false
  if (columnType.startsWith(LowCardinalityPrefix)) {
    columnType = columnType.slice(LowCardinalityPrefix.length, -1)
  }
  if (columnType.startsWith(NullablePrefix)) {
    columnType = columnType.slice(NullablePrefix.length, -1)
    isNullable = true
  }
  let result: ParsedColumnType
  if (columnType.startsWith(DecimalPrefix)) {
    const params = parseDecimalParams({
      dbType,
      columnType,
    })
    result = {
      type: 'Decimal',
      params,
      dbType,
    }
  } else if (
    columnType.startsWith(Enum8Prefix) ||
    columnType.startsWith(Enum16Prefix)
  ) {
    result = parseEnum({ dbType, columnType })
  } else if (columnType.startsWith(ArrayPrefix)) {
    result = parseArrayType({ dbType, columnType })
  } else if (columnType.startsWith(MapPrefix)) {
    throw ClickHouseRowBinaryError.headerDecodingError(
      'Map types are not supported yet',
      { columnType }
    )
  } else {
    // "Simple" types
    if (columnType in RowBinarySimpleDecoders) {
      result = {
        type: 'Simple',
        columnType: columnType as SimpleColumnType,
        dbType,
      }
    } else {
      throw ClickHouseRowBinaryError.headerDecodingError(
        'Unsupported column type',
        { columnType }
      )
    }
  }
  if (isNullable) {
    return asNullableType(result, dbType)
  } else {
    return result
  }
}

export function parseDecimalParams({
  columnType,
  dbType,
}: ParseColumnTypeParams): DecimalParams {
  if (!columnType.startsWith(DecimalPrefix)) {
    throw ClickHouseRowBinaryError.headerDecodingError('Invalid Decimal type', {
      dbType,
      columnType,
    })
  }

  const split = columnType.slice(DecimalPrefix.length, -1).split(',')
  if (split.length !== 2) {
    throw ClickHouseRowBinaryError.headerDecodingError('Invalid Decimal type', {
      dbType,
      columnType,
      split,
    })
  }
  const params: DecimalParams = {
    precision: parseInt(split[0], 10),
    scale: parseInt(split[1], 10),
    intSize: 32,
  }
  if (params.precision > 38) {
    params.intSize = 256
  } else if (params.precision > 18) {
    params.intSize = 128
  } else if (params.precision > 9) {
    params.intSize = 64
  }
  return params
}

export function parseEnum({
  columnType,
  dbType,
}: ParseColumnTypeParams): ParsedColumnEnum {
  let intSize: 8 | 16
  if (columnType.startsWith(Enum8Prefix)) {
    columnType = columnType.slice(Enum8Prefix.length, -1)
    intSize = 8
  } else if (columnType.startsWith(Enum16Prefix)) {
    columnType = columnType.slice(Enum16Prefix.length, -1)
    intSize = 16
  } else {
    throw ClickHouseRowBinaryError.headerDecodingError(
      'Expected Enum to be either Enum8 or Enum16',
      {
        columnType,
        dbType,
      }
    )
  }
  const matches = [...columnType.matchAll(/(?:'(.*?)' = (\d+),?)+/g)]
  if (matches.length === 0) {
    throw ClickHouseRowBinaryError.headerDecodingError(
      'Invalid Enum type values',
      {
        columnType,
        dbType,
      }
    )
  }

  // FIXME: regex is not enough to validate possibly incorrect Enum values.
  //  needs to be processed char by char instead.
  const names: string[] = []
  const values = new Map<number, string>()
  for (const match of matches) {
    const index = parseInt(match[2], 10)
    if (index < 0 || Number.isNaN(index)) {
      throw ClickHouseRowBinaryError.headerDecodingError(
        'Enum index must be >= 0',
        { columnType, dbType, index, matches: [...matches] }
      )
    }
    if (values.has(index)) {
      throw ClickHouseRowBinaryError.headerDecodingError(
        'Duplicate Enum index',
        { columnType, dbType, index, matches: [...matches] }
      )
    }
    if (names.includes(match[1])) {
      throw ClickHouseRowBinaryError.headerDecodingError(
        'Duplicate Enum name',
        { columnType, dbType, name: match[1], matches: [...matches] }
      )
    }
    values.set(index, match[1])
    names.push(match[1])
  }

  return {
    type: 'Enum',
    intSize,
    values,
    dbType,
  }
}

export function parseTupleType({
  columnType,
  dbType,
}: ParseColumnTypeParams): ParseColumnTuple {
  if (!columnType.startsWith(TuplePrefix)) {
    throw ClickHouseRowBinaryError.headerDecodingError('Invalid Tuple type', {
      columnType,
      dbType,
    })
  }
  columnType = columnType.slice(TuplePrefix.length, -1)
  // TODO.
  return {
    type: 'Tuple',
    elements: [],
    dbType,
  }
}

export function parseArrayType({
  columnType,
  dbType,
}: ParseColumnTypeParams): ParsedColumnArray {
  if (!columnType.startsWith(ArrayPrefix)) {
    throw ClickHouseRowBinaryError.headerDecodingError('Invalid Array type', {
      columnType,
      dbType,
    })
  }

  let dimensions = 0
  while (columnType.length > 0) {
    if (columnType.startsWith(ArrayPrefix)) {
      columnType.slice(ArrayPrefix.length, -1) // Array(T) -> T
      dimensions++
    } else {
      break
    }
  }
  if (dimensions === 0) {
    throw ClickHouseRowBinaryError.headerDecodingError(
      'Array type without dimensions',
      { columnType }
    )
  }
  if (dimensions > 10) {
    throw ClickHouseRowBinaryError.headerDecodingError(
      'Array type with too many dimensions',
      { columnType }
    )
  }
  const valueNullable = columnType.startsWith(NullablePrefix)
  if (valueNullable) {
    columnType = columnType.slice(NullablePrefix.length, -1)
  }
  if (columnType.startsWith(DecimalPrefix)) {
    const decimalParams = parseDecimalParams({
      dbType,
      columnType,
    })
    return {
      type: 'Array',
      valueType: 'Decimal',
      valueNullable,
      decimalParams,
      dimensions,
      dbType,
    }
  }
  if (columnType in RowBinarySimpleDecoders) {
    return {
      type: 'Array',
      valueType: columnType as SimpleColumnType,
      valueNullable,
      dimensions,
      dbType,
    }
  }
  throw ClickHouseRowBinaryError.headerDecodingError(
    'Unsupported array value type',
    { dbType, columnType }
  )
}

export function asNullableType(
  result:
    | ParsedColumnSimple
    | ParsedColumnEnum
    | ParsedColumnDecimal
    | ParsedColumnArray,
  dbType: string
): ParsedColumnNullable {
  if (result.type === 'Array') {
    throw ClickHouseRowBinaryError.headerDecodingError(
      'Array cannot be Nullable',
      { dbType }
    )
  }
  if (result.type === 'Decimal') {
    return {
      type: 'Nullable',
      valueType: 'Decimal',
      decimalParams: result.params,
      dbType,
    }
  }
  if (result.type === 'Enum') {
    return {
      type: 'Nullable',
      valueType: 'Enum',
      values: result.values,
      intSize: result.intSize,
      dbType,
    }
  }
  return {
    type: 'Nullable',
    valueType: result.columnType,
    dbType,
  }
}

interface ParseColumnTypeParams {
  dbType: string
  columnType: string
}

const NullablePrefix = 'Nullable(' as const
const LowCardinalityPrefix = 'LowCardinality(' as const
const DecimalPrefix = 'Decimal(' as const
const ArrayPrefix = 'Array(' as const
const MapPrefix = 'Map(' as const
const Enum8Prefix = 'Enum8(' as const
const Enum16Prefix = 'Enum16(' as const
const TuplePrefix = 'Tuple(' as const
