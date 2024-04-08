import type {
  DecimalParams,
  ParsedColumnArray,
  ParsedColumnNullable,
  ParsedColumnType,
} from './columns_parser'
import { parseColumnType } from './columns_parser'
import { ClickHouseRowBinaryError } from './errors'
import type { DecodeResult } from './read_bytes'
import { readBytesAsUnsignedLEB128 } from './read_bytes'
import type { SimpleTypeDecoder } from './types'
import { RowBinarySimpleDecoders, RowBinaryTypesDecoder } from './types'

export type DecodedColumns = DecodeResult<{
  names: string[]
  types: ParsedColumnType[]
  decoders: SimpleTypeDecoder[]
}>

/** @throws ClickHouseRowBinaryError */
export class RowBinaryColumnsHeader {
  static decode(src: Buffer): DecodedColumns {
    const res = readBytesAsUnsignedLEB128(src, 0)
    if (res === null) {
      throw ClickHouseRowBinaryError.headerDecodingError(
        'Not enough data to decode number of columns',
        {},
      )
    }
    const numColumns = res[0]
    if (numColumns === 0) {
      throw ClickHouseRowBinaryError.headerDecodingError(
        'Unexpected zero number of columns',
        {},
      )
    }
    let nextLoc = res[1]
    const names = new Array<string>(numColumns)
    const types = new Array<ParsedColumnType>(numColumns)
    const decoders = new Array<SimpleTypeDecoder>(numColumns)
    for (let i = 0; i < numColumns; i++) {
      const res = RowBinaryTypesDecoder.string(src, nextLoc)
      if (res === null) {
        throw ClickHouseRowBinaryError.headerDecodingError(
          `Not enough data to decode column name`,
          { i, names, numColumns, nextLoc },
        )
      }
      nextLoc = res[1]
      names[i] = res[0]
    }
    for (let i = 0; i < numColumns; i++) {
      const res = RowBinaryTypesDecoder.string(src, nextLoc)
      if (res === null) {
        throw ClickHouseRowBinaryError.headerDecodingError(
          `Not enough data to decode column type`,
          { i, names, types, numColumns, nextLoc },
        )
      }
      nextLoc = res[1]
      const col = parseColumnType(res[0])
      types[i] = col
      switch (col.type) {
        case 'Simple':
          decoders[i] = RowBinarySimpleDecoders[col.columnType]
          break
        case 'Decimal':
          decoders[i] = getDecimalDecoder(col.params)
          break
        case 'Array':
          decoders[i] = getArrayDecoder(col)
          break
        case 'Nullable':
          decoders[i] = getNullableDecoder(col)
          break
        default:
          throw ClickHouseRowBinaryError.headerDecodingError(
            `Unsupported column type ${col.type}`,
            { col },
          )
      }
    }
    // console.log(`Decoded columns:`, names, types)
    return [{ names, types, decoders }, nextLoc]
  }
}

function getDecimalDecoder(decimalParams: DecimalParams): SimpleTypeDecoder {
  const intSize = decimalParams.intSize
  if (intSize === 32) {
    return RowBinaryTypesDecoder.decimal32(decimalParams.scale)
  }
  if (intSize === 64) {
    return RowBinaryTypesDecoder.decimal64(decimalParams.scale)
  }
  // for tests only (128 and 256 support is there)
  throw new Error(`Unsupported Decimal size: ${intSize}`)
}

function getEnumDecoder(
  intSize: 8 | 16,
  values: Map<number, string>,
): SimpleTypeDecoder {
  if (intSize === 8) {
    return RowBinaryTypesDecoder.enum8(values)
  }
  if (intSize === 16) {
    return RowBinaryTypesDecoder.enum16(values)
  }
  throw new Error(`Unsupported Enum size: ${intSize}`)
}

function getArrayDecoder(col: ParsedColumnArray): SimpleTypeDecoder {
  let valueDecoder
  if (col.value.type === 'Simple') {
    valueDecoder = RowBinarySimpleDecoders[col.value.columnType]
  } else if (col.value.type === 'Decimal') {
    valueDecoder = getDecimalDecoder(col.value.params)
  } else if (col.value.type === 'Enum') {
    valueDecoder = getEnumDecoder(col.value.intSize, col.value.values)
  } else if (col.value.type === 'Nullable') {
    valueDecoder = getNullableDecoder(col.value)
  } else {
    // FIXME: add other types
    throw new Error(`Unsupported Array value type: ${col.value.type}`)
  }
  return RowBinaryTypesDecoder.array(valueDecoder, col.dimensions)
}

function getNullableDecoder(col: ParsedColumnNullable) {
  let valueDecoder
  if (col.value.type === 'Simple') {
    valueDecoder = RowBinarySimpleDecoders[col.value.columnType]
  } else if (col.value.type === 'Decimal') {
    valueDecoder = getDecimalDecoder(col.value.params)
  } else if (col.value.type === 'Enum') {
    valueDecoder = getEnumDecoder(col.value.intSize, col.value.values)
  } else {
    // FIXME: add other types
    throw new Error(`Unsupported Nullable value type: ${col.value.type}`)
  }
  return RowBinaryTypesDecoder.nullable(valueDecoder)
}
