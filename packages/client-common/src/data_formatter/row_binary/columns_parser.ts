import { ClickHouseRowBinaryError } from './errors'
import type { SimpleColumnType } from './types'
import { RowBinarySimpleDecoders } from './types'

export interface ParsedColumnSimple {
  type: 'Simple'
  /** Without LowCardinality and Nullable. For example:
   *  * UInt8 -> UInt8
   *  * LowCardinality(Nullable(String)) -> String */
  columnType: SimpleColumnType
  /** ClickHouse type as it is defined in the table. */
  dbType: string
}

interface ParsedColumnNullableBase {
  type: 'Nullable'
  dbType: string
}
export type ParsedColumnNullable =
  | (ParsedColumnNullableBase & {
      /** Used to determine how to decode T from Nullable(T) */
      valueType: SimpleColumnType
    })
  | (ParsedColumnNullableBase & {
      valueType: 'Decimal'
      decimalParams: ParsedColumnDecimal['params']
    })
  | (ParsedColumnNullableBase & {
      valueType: 'Enum'
      values: ParsedColumnEnum['values']
      intSize: ParsedColumnEnum['intSize']
    })

export interface ParsedColumnEnum {
  type: 'Enum'
  /** Index to name */
  values: Map<number, string>
  /** UInt8 or UInt16 */
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
interface ParsedColumnArrayBase {
  type: 'Array'
  valueNullable: boolean
  /** Array(T) = 1 dimension, Array(Array(T)) = 2, etc. */
  dimensions: number
  dbType: string
}
export type ParsedColumnArray =
  | (ParsedColumnArrayBase & {
      /** Represents the final value type; nested arrays are handled with {@link ParsedColumnArray.dimensions} */
      valueType: SimpleColumnType
    })
  | (ParsedColumnArrayBase & {
      valueType: 'Decimal'
      decimalParams: DecimalParams
    })
  | (ParsedColumnArrayBase & {
      valueType: 'Enum'
      values: ParsedColumnEnum['values']
      intSize: ParsedColumnEnum['intSize']
    }) // TODO: add Tuple support.

// export interface ParsedColumnMap {
//   type: 'Map'
//   key: ParsedColumnSimple
//   value: ParsedColumnType
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

  if (columnType.length < 2) {
    throw ClickHouseRowBinaryError.headerDecodingError(
      'Invalid Enum type values',
      {
        columnType,
        dbType,
      }
    )
  }

  const names: string[] = []
  const indices: number[] = []
  let parsingName = true // false when parsing the index
  let charEscaped = false // we should ignore escaped ticks
  let startIndex = 1 // Skip the first '

  function pushEnumIndex(start: number, end: number) {
    const index = parseInt(columnType.slice(start, end), 10)
    if (Number.isNaN(index) || index < 0) {
      throw ClickHouseRowBinaryError.headerDecodingError(
        'Expected Enum index to be a valid number',
        {
          columnType,
          dbType,
          names,
          indices,
          index,
          start,
          end,
        }
      )
    }
    if (indices.includes(index)) {
      throw ClickHouseRowBinaryError.headerDecodingError(
        'Duplicate Enum index',
        { columnType, dbType, index, names, indices }
      )
    }
    indices.push(index)
  }

  // Should support the most complicated enums, such as Enum8('f\'' = 1, 'x =' = 2, 'b\'\'\'' = 3, '\'c=4=' = 42, '4' = 100)
  for (let i = 1; i < columnType.length; i++) {
    if (parsingName) {
      if (!charEscaped) {
        if (columnType[i] === '\\') {
          charEscaped = true
        } else if (columnType[i] === "'") {
          // non-escaped closing tick - push the name
          const name = columnType.slice(startIndex, i)
          if (names.includes(name)) {
            throw ClickHouseRowBinaryError.headerDecodingError(
              'Duplicate Enum name',
              { columnType, dbType, name, names, indices }
            )
          }
          names.push(name)
          i += 4 // skip ` = ` and the first digit, as it will always have at least one.
          startIndex = i
          parsingName = false
        }
      } else {
        // current char was escaped, ignoring.
        charEscaped = false
      }
    } else {
      // Parsing the index
      if (columnType[i] < '0' || columnType[i] > '9') {
        pushEnumIndex(startIndex, i)
        // the char at this index should be comma.
        i += 2 // skip ` '`, but not the first char - ClickHouse allows something like Enum8('foo' = 0, '' = 42)
        startIndex = i + 1
        parsingName = true
        charEscaped = false
      }
    }
  }

  // Push the last index
  pushEnumIndex(startIndex, columnType.length)
  if (names.length !== indices.length) {
    throw ClickHouseRowBinaryError.headerDecodingError(
      'Expected Enum to have the same number of names and indices',
      { columnType, dbType, names, indices }
    )
  }

  const values = new Map<number, string>()
  for (let i = 0; i < names.length; i++) {
    values.set(indices[i], names[i])
  }

  return {
    type: 'Enum',
    values,
    intSize,
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
  if (
    columnType.startsWith(Enum8Prefix) ||
    columnType.startsWith(Enum16Prefix)
  ) {
    const { values, intSize } = parseEnum({ dbType, columnType })
    return {
      type: 'Array',
      valueType: 'Enum',
      valueNullable,
      values,
      intSize,
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
