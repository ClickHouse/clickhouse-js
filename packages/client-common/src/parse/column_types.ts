export class ColumnTypeParseError extends Error {
  readonly args: Record<string, unknown>
  constructor(message: string, args?: Record<string, unknown>) {
    super(message)
    this.args = args ?? {}

    // Set the prototype explicitly, see:
    // https://github.com/Microsoft/TypeScript/wiki/Breaking-Changes#extending-built-ins-like-error-array-and-map-may-no-longer-work
    Object.setPrototypeOf(this, ColumnTypeParseError.prototype)
  }
}

export const SimpleColumnTypes = [
  'Bool',
  'UInt8',
  'Int8',
  'UInt16',
  'Int16',
  'UInt32',
  'Int32',
  'UInt64',
  'Int64',
  'UInt128',
  'Int128',
  'UInt256',
  'Int256',
  'Float32',
  'Float64',
  'String',
  'UUID',
  'Date',
  'Date32',
  'IPv4',
  'IPv6',
] as const
export type SimpleColumnType = (typeof SimpleColumnTypes)[number]

export interface ParsedColumnSimple {
  type: 'Simple'
  /** Without LowCardinality and Nullable. For example:
   *  * UInt8 -> UInt8
   *  * LowCardinality(Nullable(String)) -> String */
  columnType: SimpleColumnType
  /** The original type before parsing. */
  sourceType: string
}

export interface ParsedColumnFixedString {
  type: 'FixedString'
  sizeBytes: number
  sourceType: string
}

export interface ParsedColumnDateTime {
  type: 'DateTime'
  timezone: string | null
  sourceType: string
}

export interface ParsedColumnDateTime64 {
  type: 'DateTime64'
  timezone: string | null
  /** Valid range: [0 : 9] */
  precision: number
  sourceType: string
}

export interface ParsedColumnEnum {
  type: 'Enum'
  /** Index to name */
  values: Record<number, string>
  /** UInt8 or UInt16 */
  intSize: 8 | 16
  sourceType: string
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
  sourceType: string
}

/** Tuple, Array or Map itself cannot be Nullable */
export interface ParsedColumnNullable {
  type: 'Nullable'
  value:
    | ParsedColumnSimple
    | ParsedColumnEnum
    | ParsedColumnDecimal
    | ParsedColumnFixedString
    | ParsedColumnDateTime
    | ParsedColumnDateTime64
  sourceType: string
}

/** Array cannot be Nullable or LowCardinality, but its value type can be.
 *  Arrays can be multidimensional, e.g. Array(Array(Array(T))).
 *  Arrays are allowed to have a Map as the value type.
 */
export interface ParsedColumnArray {
  type: 'Array'
  value:
    | ParsedColumnNullable
    | ParsedColumnSimple
    | ParsedColumnFixedString
    | ParsedColumnDecimal
    | ParsedColumnEnum
    | ParsedColumnMap
    | ParsedColumnDateTime
    | ParsedColumnDateTime64
    | ParsedColumnTuple
  /** Array(T) = 1 dimension, Array(Array(T)) = 2, etc. */
  dimensions: number
  sourceType: string
}

/** @see https://clickhouse.com/docs/en/sql-reference/data-types/map */
export interface ParsedColumnMap {
  type: 'Map'
  /** Possible key types:
   *  - String, Integer, UUID, Date, Date32, etc ({@link ParsedColumnSimple})
   *  - FixedString
   *  - DateTime
   *  - Enum
   */
  key:
    | ParsedColumnSimple
    | ParsedColumnFixedString
    | ParsedColumnEnum
    | ParsedColumnDateTime
  /** Value types are arbitrary, including Map, Array, and Tuple. */
  value: ParsedColumnType
  sourceType: string
}

export interface ParsedColumnTuple {
  type: 'Tuple'
  /** Element types are arbitrary, including Map, Array, and Tuple. */
  elements: ParsedColumnType[]
  sourceType: string
}

export type ParsedColumnType =
  | ParsedColumnSimple
  | ParsedColumnEnum
  | ParsedColumnFixedString
  | ParsedColumnNullable
  | ParsedColumnDecimal
  | ParsedColumnDateTime
  | ParsedColumnDateTime64
  | ParsedColumnArray
  | ParsedColumnTuple
  | ParsedColumnMap

export function parseColumnType(sourceType: string): ParsedColumnType {
  let columnType = sourceType
  let isNullable = false
  if (columnType.startsWith(LowCardinalityPrefix)) {
    columnType = columnType.slice(LowCardinalityPrefix.length, -1)
  }
  if (columnType.startsWith(NullablePrefix)) {
    columnType = columnType.slice(NullablePrefix.length, -1)
    isNullable = true
  }
  let result: ParsedColumnType
  if ((SimpleColumnTypes as unknown as string[]).includes(columnType)) {
    result = {
      type: 'Simple',
      columnType: columnType as SimpleColumnType,
      sourceType,
    }
  } else if (columnType.startsWith(DecimalPrefix)) {
    result = parseDecimalType({
      sourceType,
      columnType,
    })
  } else if (columnType.startsWith(DateTime64Prefix)) {
    result = parseDateTime64Type({ sourceType, columnType })
  } else if (columnType.startsWith(DateTimePrefix)) {
    result = parseDateTimeType({ sourceType, columnType })
  } else if (columnType.startsWith(FixedStringPrefix)) {
    result = parseFixedStringType({ sourceType, columnType })
  } else if (
    columnType.startsWith(Enum8Prefix) ||
    columnType.startsWith(Enum16Prefix)
  ) {
    result = parseEnumType({ sourceType, columnType })
  } else if (columnType.startsWith(ArrayPrefix)) {
    result = parseArrayType({ sourceType, columnType })
  } else if (columnType.startsWith(MapPrefix)) {
    result = parseMapType({ sourceType, columnType })
  } else if (columnType.startsWith(TuplePrefix)) {
    result = parseTupleType({ sourceType, columnType })
  } else {
    throw new ColumnTypeParseError('Unsupported column type', { columnType })
  }
  if (isNullable) {
    return asNullableType(result, sourceType)
  } else {
    return result
  }
}

export function parseDecimalType({
  columnType,
  sourceType,
}: ParseColumnTypeParams): ParsedColumnDecimal {
  if (
    !columnType.startsWith(DecimalPrefix) ||
    columnType.length < DecimalPrefix.length + 5 // Decimal(1, 0) is the shortest valid definition
  ) {
    throw new ColumnTypeParseError('Invalid Decimal type', {
      sourceType,
      columnType,
    })
  }
  const split = columnType.slice(DecimalPrefix.length, -1).split(', ')
  if (split.length !== 2) {
    throw new ColumnTypeParseError(
      'Expected Decimal type to have both precision and scale',
      {
        sourceType,
        columnType,
        split,
      },
    )
  }
  let intSize: DecimalParams['intSize'] = 32
  const precision = parseInt(split[0], 10)
  if (Number.isNaN(precision) || precision < 1 || precision > 76) {
    throw new ColumnTypeParseError('Invalid Decimal precision', {
      columnType,
      sourceType,
      precision,
    })
  }
  const scale = parseInt(split[1], 10)
  if (Number.isNaN(scale) || scale < 0 || scale > precision) {
    throw new ColumnTypeParseError('Invalid Decimal scale', {
      columnType,
      sourceType,
      precision,
      scale,
    })
  }
  if (precision > 38) {
    intSize = 256
  } else if (precision > 18) {
    intSize = 128
  } else if (precision > 9) {
    intSize = 64
  }
  return {
    type: 'Decimal',
    params: {
      precision,
      scale,
      intSize,
    },
    sourceType,
  }
}

export function parseEnumType({
  columnType,
  sourceType,
}: ParseColumnTypeParams): ParsedColumnEnum {
  let intSize: 8 | 16
  if (columnType.startsWith(Enum8Prefix)) {
    columnType = columnType.slice(Enum8Prefix.length, -1)
    intSize = 8
  } else if (columnType.startsWith(Enum16Prefix)) {
    columnType = columnType.slice(Enum16Prefix.length, -1)
    intSize = 16
  } else {
    throw new ColumnTypeParseError(
      'Expected Enum to be either Enum8 or Enum16',
      {
        columnType,
        sourceType,
      },
    )
  }
  // The minimal allowed Enum definition is Enum8('' = 0), i.e. 6 chars inside.
  if (columnType.length < 6) {
    throw new ColumnTypeParseError('Invalid Enum type values', {
      columnType,
      sourceType,
    })
  }

  const names: string[] = []
  const indices: number[] = []
  let parsingName = true // false when parsing the index
  let charEscaped = false // we should ignore escaped ticks
  let startIndex = 1 // Skip the first '

  // Should support the most complicated enums, such as Enum8('f\'' = 1, 'x =' = 2, 'b\'\'\'' = 3, '\'c=4=' = 42, '4' = 100)
  for (let i = 1; i < columnType.length; i++) {
    if (parsingName) {
      if (charEscaped) {
        charEscaped = false
      } else {
        if (columnType.charCodeAt(i) === BackslashASCII) {
          charEscaped = true
        } else if (columnType.charCodeAt(i) === SingleQuoteASCII) {
          // non-escaped closing tick - push the name
          const name = columnType.slice(startIndex, i)
          if (names.includes(name)) {
            throw new ColumnTypeParseError('Duplicate Enum name', {
              columnType,
              sourceType,
              name,
              names,
              indices,
            })
          }
          names.push(name)
          i += 4 // skip ` = ` and the first digit, as it will always have at least one.
          startIndex = i
          parsingName = false
        }
      }
    }
    // Parsing the index, skipping next iterations until the first non-digit one
    else if (
      columnType.charCodeAt(i) < ZeroASCII ||
      columnType.charCodeAt(i) > NineASCII
    ) {
      pushEnumIndex(startIndex, i)
      // the char at this index should be comma.
      i += 2 // skip ` '`, but not the first char - ClickHouse allows something like Enum8('foo' = 0, '' = 42)
      startIndex = i + 1
      parsingName = true
      charEscaped = false
    }
  }

  // Push the last index
  pushEnumIndex(startIndex, columnType.length)
  if (names.length !== indices.length) {
    throw new ColumnTypeParseError(
      'Expected Enum to have the same number of names and indices',
      { columnType, sourceType, names, indices },
    )
  }

  const values: ParsedColumnEnum['values'] = {}
  for (let i = 0; i < names.length; i++) {
    values[indices[i]] = names[i]
  }
  return {
    type: 'Enum',
    values,
    intSize,
    sourceType,
  }

  function pushEnumIndex(start: number, end: number) {
    const index = parseInt(columnType.slice(start, end), 10)
    if (Number.isNaN(index) || index < 0) {
      throw new ColumnTypeParseError(
        'Expected Enum index to be a valid number',
        {
          columnType,
          sourceType,
          names,
          indices,
          index,
          start,
          end,
        },
      )
    }
    if (indices.includes(index)) {
      throw new ColumnTypeParseError('Duplicate Enum index', {
        columnType,
        sourceType,
        index,
        names,
        indices,
      })
    }
    indices.push(index)
  }
}

export function parseMapType({
  columnType,
  sourceType,
}: ParseColumnTypeParams): ParsedColumnMap {
  if (
    !columnType.startsWith(MapPrefix) ||
    columnType.length < MapPrefix.length + 11 // the shortest definition seems to be Map(Int8, Int8)
  ) {
    throw new ColumnTypeParseError('Invalid Map type', {
      columnType,
      sourceType,
    })
  }
  columnType = columnType.slice(MapPrefix.length, -1)
  const [keyType, valueType] = getElementsTypes({ columnType, sourceType }, 2)
  const key = parseColumnType(keyType)
  if (
    key.type === 'DateTime64' ||
    key.type === 'Nullable' ||
    key.type === 'Array' ||
    key.type === 'Map' ||
    key.type === 'Decimal' ||
    key.type === 'Tuple'
  ) {
    throw new ColumnTypeParseError('Invalid Map key type', {
      key,
      sourceType,
    })
  }
  const value = parseColumnType(valueType)
  return {
    type: 'Map',
    key,
    value,
    sourceType,
  }
}

export function parseTupleType({
  columnType,
  sourceType,
}: ParseColumnTypeParams): ParsedColumnTuple {
  if (
    !columnType.startsWith(TuplePrefix) ||
    columnType.length < TuplePrefix.length + 5 // Tuple(Int8) is the shortest valid definition
  ) {
    throw new ColumnTypeParseError('Invalid Tuple type', {
      columnType,
      sourceType,
    })
  }
  columnType = columnType.slice(TuplePrefix.length, -1)
  const elements = getElementsTypes({ columnType, sourceType }, 1).map((type) =>
    parseColumnType(type),
  )
  return {
    type: 'Tuple',
    elements,
    sourceType,
  }
}

export function parseArrayType({
  columnType,
  sourceType,
}: ParseColumnTypeParams): ParsedColumnArray {
  if (
    !columnType.startsWith(ArrayPrefix) ||
    columnType.length < ArrayPrefix.length + 5 // Array(Int8) is the shortest valid definition
  ) {
    throw new ColumnTypeParseError('Invalid Array type', {
      columnType,
      sourceType,
    })
  }

  let dimensions = 0
  while (columnType.length > 0) {
    if (columnType.startsWith(ArrayPrefix)) {
      columnType = columnType.slice(ArrayPrefix.length, -1) // Array(T) -> T
      dimensions++
    } else {
      break
    }
  }
  if (dimensions === 0 || dimensions > 10) {
    // TODO: check how many we can handle; max 10 seems more than enough.
    throw new ColumnTypeParseError(
      'Expected Array to have between 1 and 10 dimensions',
      { columnType },
    )
  }
  const value = parseColumnType(columnType)
  if (value.type === 'Array') {
    throw new ColumnTypeParseError('Unexpected Array as value type', {
      columnType,
      sourceType,
    })
  }
  return {
    type: 'Array',
    value,
    dimensions,
    sourceType,
  }
}

export function parseDateTimeType({
  columnType,
  sourceType,
}: ParseColumnTypeParams): ParsedColumnDateTime {
  if (
    columnType.startsWith(DateTimeWithTimezonePrefix) &&
    columnType.length > DateTimeWithTimezonePrefix.length + 4 // DateTime('GB') has the least amount of chars
  ) {
    const timezone = columnType.slice(DateTimeWithTimezonePrefix.length + 1, -2)
    return {
      type: 'DateTime',
      timezone,
      sourceType,
    }
  } else if (
    columnType.startsWith(DateTimePrefix) &&
    columnType.length === DateTimePrefix.length
  ) {
    return {
      type: 'DateTime',
      timezone: null,
      sourceType,
    }
  } else {
    throw new ColumnTypeParseError('Invalid DateTime type', {
      columnType,
      sourceType,
    })
  }
}

export function parseDateTime64Type({
  columnType,
  sourceType,
}: ParseColumnTypeParams): ParsedColumnDateTime64 {
  if (
    !columnType.startsWith(DateTime64Prefix) ||
    columnType.length < DateTime64Prefix.length + 2 // should at least have a precision
  ) {
    throw new ColumnTypeParseError('Invalid DateTime64 type', {
      columnType,
      sourceType,
    })
  }
  const precision = parseInt(columnType[DateTime64Prefix.length], 10)
  if (Number.isNaN(precision) || precision < 0 || precision > 9) {
    throw new ColumnTypeParseError('Invalid DateTime64 precision', {
      columnType,
      sourceType,
      precision,
    })
  }
  let timezone = null
  if (columnType.length > DateTime64Prefix.length + 2) {
    // e.g. DateTime64(3, 'UTC') -> UTC
    timezone = columnType.slice(DateTime64Prefix.length + 4, -2)
  }
  return {
    type: 'DateTime64',
    timezone,
    precision,
    sourceType,
  }
}

export function parseFixedStringType({
  columnType,
  sourceType,
}: ParseColumnTypeParams): ParsedColumnFixedString {
  if (
    !columnType.startsWith(FixedStringPrefix) ||
    columnType.length < FixedStringPrefix.length + 2 // i.e. at least FixedString(1)
  ) {
    throw new ColumnTypeParseError('Invalid FixedString type', {
      columnType,
      sourceType,
    })
  }
  const sizeBytes = parseInt(columnType.slice(FixedStringPrefix.length, -1), 10)
  if (Number.isNaN(sizeBytes) || sizeBytes < 1) {
    throw new ColumnTypeParseError('Invalid FixedString size in bytes', {
      columnType,
      sourceType,
      sizeBytes,
    })
  }
  return {
    type: 'FixedString',
    sizeBytes,
    sourceType,
  }
}

export function asNullableType(
  value: ParsedColumnType,
  sourceType: string,
): ParsedColumnNullable {
  if (
    value.type === 'Array' ||
    value.type === 'Map' ||
    value.type === 'Tuple' ||
    value.type === 'Nullable'
  ) {
    throw new ColumnTypeParseError(`${value.type} cannot be Nullable`, {
      sourceType,
    })
  }
  if (value.sourceType.startsWith(NullablePrefix)) {
    value.sourceType = value.sourceType.slice(NullablePrefix.length, -1)
  }
  return {
    type: 'Nullable',
    sourceType,
    value,
  }
}

/** Used for Map key/value types and Tuple elements.
 *  * `String, UInt8` results in [`String`, `UInt8`].
 *  * `String, UInt8, Array(String)` results in [`String`, `UInt8`, `Array(String)`].
 *  * Throws if parsed values are below the required minimum. */
export function getElementsTypes(
  { columnType, sourceType }: ParseColumnTypeParams,
  minElements: number,
): string[] {
  const elements: string[] = []
  /** Consider the element type parsed once we reach a comma outside of parens AND after an unescaped tick.
   *  The most complicated cases are values names in the self-defined Enum types:
   *  * `Tuple(Enum8('f\'()' = 1))`  ->  `f\'()`
   *  * `Tuple(Enum8('(' = 1))`      ->  `(`
   *  See also: {@link parseEnumType }, which works similarly (but has to deal with the indices following the names). */
  let openParens = 0
  let quoteOpen = false
  let charEscaped = false
  let lastElementIndex = 0
  for (let i = 0; i < columnType.length; i++) {
    // prettier-ignore
    // console.log(i, 'Current char:', columnType[i], 'openParens:', openParens, 'quoteOpen:', quoteOpen, 'charEscaped:', charEscaped)
    if (charEscaped) {
      charEscaped = false
    } else if (columnType.charCodeAt(i) === BackslashASCII) {
      charEscaped = true
    } else if (columnType.charCodeAt(i) === SingleQuoteASCII) {
      quoteOpen = !quoteOpen // unescaped quote
    } else {
      if (!quoteOpen) {
        if (columnType.charCodeAt(i) === LeftParenASCII) {
          openParens++
        } else if (columnType.charCodeAt(i) === RightParenASCII) {
          openParens--
        } else if (columnType.charCodeAt(i) === CommaASCII) {
          if (openParens === 0) {
            elements.push(columnType.slice(lastElementIndex, i))
            // console.log('Pushed element:', elements[elements.length - 1])
            i += 2 // skip ', '
            lastElementIndex = i
          }
        }
      }
    }
  }

  // prettier-ignore
  // console.log('Final elements:', elements, 'nextElementIndex:', lastElementIndex, 'minElements:', minElements, 'openParens:', openParens)

  // Push the remaining part of the type if it seems to be valid (at least all parentheses are closed)
  if (!openParens && lastElementIndex < columnType.length - 1) {
    elements.push(columnType.slice(lastElementIndex))
  }
  if (elements.length < minElements) {
    throw new ColumnTypeParseError('Expected more elements in the type', {
      sourceType,
      columnType,
      elements,
      minElements,
    })
  }
  return elements
}

interface ParseColumnTypeParams {
  /** A particular type to parse, such as DateTime. */
  columnType: string
  /** Full type definition, such as Map(String, DateTime). */
  sourceType: string
}

const NullablePrefix = 'Nullable(' as const
const LowCardinalityPrefix = 'LowCardinality(' as const
const DecimalPrefix = 'Decimal(' as const
const ArrayPrefix = 'Array(' as const
const MapPrefix = 'Map(' as const
const Enum8Prefix = 'Enum8(' as const
const Enum16Prefix = 'Enum16(' as const
const TuplePrefix = 'Tuple(' as const
const DateTimePrefix = 'DateTime' as const
const DateTimeWithTimezonePrefix = 'DateTime(' as const
const DateTime64Prefix = 'DateTime64(' as const
const FixedStringPrefix = 'FixedString(' as const

const SingleQuoteASCII = 39 as const
const LeftParenASCII = 40 as const
const RightParenASCII = 41 as const
const CommaASCII = 44 as const
const ZeroASCII = 48 as const
const NineASCII = 57 as const
const BackslashASCII = 92 as const
