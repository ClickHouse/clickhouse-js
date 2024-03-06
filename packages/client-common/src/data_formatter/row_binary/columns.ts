import type { DecodeResult } from './read_bytes'
import { readBytesAsUnsignedLEB128 } from './read_bytes'
import type {
  ColumnType,
  DecodedColumnType,
  DecodeError,
  TypeDecoder,
} from './types'
import { RowBinaryColumnTypeToDecoder, RowBinaryTypesDecoder } from './types'

export type DecodedColumns = DecodeResult<{
  names: string[]
  types: DecodedColumnType[]
  decoders: TypeDecoder[]
}>

export const RowBinaryColumns = {
  decode: (src: Uint8Array): DecodedColumns | DecodeError => {
    const res = readBytesAsUnsignedLEB128(src, 0)
    if (res === null) {
      return { error: 'Not enough data to decode the number of columns' }
    }
    const numColumns = res[0]
    let nextLoc = res[1]
    const names = new Array<string>(numColumns)
    const types = new Array<DecodedColumnType>(numColumns)
    const decoders: TypeDecoder[] = new Array<TypeDecoder>(numColumns)
    for (let i = 0; i < numColumns; i++) {
      const res = RowBinaryTypesDecoder.string(src, nextLoc)
      if (res === null) {
        return { error: `Not enough data to decode column ${i} name` }
      }
      nextLoc = res[1]
      names[i] = res[0]
    }
    for (let i = 0; i < numColumns; i++) {
      const res = RowBinaryTypesDecoder.string(src, nextLoc)
      if (res === null) {
        return { error: `Not enough data to decode column ${i} type` }
      }
      nextLoc = res[1]
      const decodedColumn = decodeColumnType(res[0])
      if (!(decodedColumn.columnType in RowBinaryColumnTypeToDecoder)) {
        return {
          error: `No matching type decoder for client type in ${decodedColumn}`,
        }
      }
      const columnType = decodedColumn.columnType as ColumnType
      const typeDecoder = RowBinaryColumnTypeToDecoder[columnType]
      decoders[i] = decodedColumn.isNullable
        ? RowBinaryTypesDecoder.nullable(typeDecoder)
        : typeDecoder
      types[i] = {
        ...decodedColumn,
        columnType,
      }
    }
    // console.log(`Decoded columns: ${names}, ${types}`)
    return [{ names, types, decoders }, nextLoc]
  },
}

type DecodeColumnSimpleType = {
  type: 'Simple'
  // from ClickHouse as is
  dbType: string
  // without LowCardinality and Nullable
  columnType: string
  isNullable: boolean
  isLowCardinality: boolean
}
type DecodeColumnArrayType = {
  type: 'Array'
  innerType:
    | DecodeColumnSimpleType
    | DecodeColumnArrayType
    | DecodeColumnMapType
}
type DecodeColumnMapType = {
  type: 'Map'
  keyType: DecodeColumnSimpleType
  valueType:
    | DecodeColumnSimpleType
    | DecodeColumnArrayType
    | DecodeColumnMapType
}
type DecodeColumnTypeResult =
  | DecodeColumnSimpleType
  | DecodeColumnArrayType
  | DecodeColumnMapType

export function decodeColumnType(dbType: string): {
  // from ClickHouse as is
  dbType: string
  // without LowCardinality and Nullable
  columnType: string
  isNullable: boolean
  isLowCardinality: boolean
  type: 'Simple'
} {
  // if (dbType.startsWith('Map(')) {
  //   dbType = dbType.slice(4, -1)
  //
  // }
  let columnType = dbType
  let isNullable = false
  let isLowCardinality = false
  if (columnType.startsWith('LowCardinality')) {
    columnType = columnType.slice(15, -1)
    isLowCardinality = true
  }
  if (columnType.startsWith('Nullable')) {
    columnType = columnType.slice(9, -1)
    isNullable = true
  }
  return {
    dbType,
    columnType,
    isNullable,
    isLowCardinality,
    type: 'Simple',
  }
}
