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
      decimalParams: DecimalParams
      dbType: string
    }

/** Array cannot be Nullable or LowCardinality, but its inner type can be.
 *  Arrays can be multidimensional, e.g. Array(Array(Array(T))).
 *  Arrays are allowed to have a Map as the inner type.
 */
export interface DecodedColumnMap {
  type: 'Map'
  key: ParsedColumnSimple
  value: ParsedColumnSimple | ParsedColumnArray | DecodedColumnMap
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
export type ParsedColumnType =
  | ParsedColumnSimple
  | ParsedColumnNullable
  | ParsedColumnDecimal
  | ParsedColumnArray
// | DecodedColumnMap  // TODO - add Map support.

export class RowBinaryColumnTypesParser {
  static parseColumnType(dbType: string): ParsedColumnType {
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
      result = {
        type: 'Decimal',
        params: RowBinaryColumnTypesParser.parseDecimalParams({
          dbType,
          columnType,
        }),
        dbType,
      }
    } else if (columnType.startsWith(ArrayPrefix)) {
      result = RowBinaryColumnTypesParser.parseArrayType({ dbType, columnType })
    } else if (columnType.startsWith(MapPrefix)) {
      throw ClickHouseRowBinaryError.headerDecodingError(
        'Map types are not supported yet',
        { columnType }
      )
    } else {
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
      // console.log('Got a nullable:', result)
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
      return {
        type: 'Nullable',
        valueType: result.columnType,
        dbType,
      }
    } else {
      return result
    }
  }

  static parseDecimalParams({
    columnType,
    dbType,
  }: ParseColumnTypeParams): DecimalParams {
    const split = columnType.slice(DecimalPrefix.length, -1).split(',')
    if (split.length !== 2) {
      throw ClickHouseRowBinaryError.headerDecodingError(
        'Invalid Decimal type',
        { dbType, columnType, split }
      )
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

  static parseArrayType({
    columnType,
    dbType,
  }: ParseColumnTypeParams): ParsedColumnArray {
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
      const decimalParams = RowBinaryColumnTypesParser.parseDecimalParams({
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
// const TuplePrefix = 'Tuple(' as const
// const EnumPrefix = 'Enum(' as const
