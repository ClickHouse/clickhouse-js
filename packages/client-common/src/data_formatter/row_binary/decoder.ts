import type { DecodeResult } from './read_bytes'
import {
  readBytesAsUnsignedBigInt,
  readBytesAsUnsignedInt,
  readBytesAsUnsignedLEB128,
} from './read_bytes'

export type ColumnType =
  | 'Bool'
  | 'UInt8'
  | 'Int8'
  | 'UInt16'
  | 'Int16'
  | 'UInt32'
  | 'Int32'
  | 'UInt64'
  | 'Int64'
  | 'UInt128'
  | 'Int128'
  | 'UInt256'
  | 'Int256'
  | 'String'
  | 'Date'

export type TypeDecoder<T = unknown> = (
  src: Uint8Array,
  loc: number
) => DecodeResult<T> | null

export type DecodeError = { error: string }
export type DecodedColumns = DecodeResult<{
  names: string[]
  types: ColumnType[]
  decoders: TypeDecoder[]
}>

const Int8Overflow = 128
const UInt8Overflow = 256

const Int16Overflow = 32768
const UInt16Overflow = 65536

const Int32Overflow = 2147483648
const UInt32Overflow = 4294967296

const Int64Overflow = 9223372036854775808n
const UInt64Overflow = 18446744073709551616n

const Int128Overflow = 170141183460469231731687303715884105728n
const UInt128Overflow = 340282366920938463463374607431768211456n

const Int256Overflow =
  57896044618658097711785492504343953926634992332820282019728792003956564819968n
const UInt256Overflow =
  115792089237316195423570985008687907853269984665640564039457584007913129639936n

const DayMillis = 24 * 3600 * 1000
const TxtDecoder = new TextDecoder()

export const RowBinaryTypesDecoder = {
  bool: (src: Uint8Array, loc: number): DecodeResult<boolean> | null => {
    if (src.length < loc + 1) return null
    return [src[loc] === 1, loc + 1]
  },
  uint8: (src: Uint8Array, loc: number): DecodeResult<number> | null => {
    if (src.length < loc + 1) return null
    return [src[loc], loc + 1]
  },
  int8: (src: Uint8Array, loc: number): DecodeResult<number> | null => {
    if (src.length < loc + 1) return null
    const x = src[loc]
    return [x < Int8Overflow ? x : x - UInt8Overflow, loc + 1]
  },
  uint16: (src: Uint8Array, loc: number): DecodeResult<number> | null => {
    if (src.length < loc + 2) return null
    return [readBytesAsUnsignedInt(src, loc, 2), loc + 2]
  },
  int16: (src: Uint8Array, loc: number): DecodeResult<number> | null => {
    if (src.length < loc + 2) return null
    const x = readBytesAsUnsignedInt(src, loc, 2)
    return [x < Int16Overflow ? x : x - UInt16Overflow, loc + 2]
  },
  uint32: (src: Uint8Array, loc: number): DecodeResult<number> | null => {
    if (src.length < loc + 4) return null
    return [readBytesAsUnsignedInt(src, loc, 4), loc + 4]
  },
  int32: (src: Uint8Array, loc: number): DecodeResult<number> | null => {
    if (src.length < loc + 4) return null
    const x = readBytesAsUnsignedInt(src, loc, 4)
    return [x < Int32Overflow ? x : x - UInt32Overflow, loc + 4]
  },
  uint64: (src: Uint8Array, loc: number): DecodeResult<bigint> | null => {
    if (src.length < loc + 8) return null
    return [readBytesAsUnsignedBigInt(src, loc, 8), loc + 8]
  },
  int64: (src: Uint8Array, loc: number): DecodeResult<bigint> | null => {
    if (src.length < loc + 8) return null
    const x = readBytesAsUnsignedBigInt(src, loc, 8)
    return [x < Int64Overflow ? x : x - UInt64Overflow, loc + 8]
  },
  uint128: (src: Uint8Array, loc: number): DecodeResult<bigint> | null => {
    if (src.length < loc + 16) return null
    return [readBytesAsUnsignedBigInt(src, loc, 16), loc + 16]
  },
  int128: (src: Uint8Array, loc: number): DecodeResult<bigint> | null => {
    if (src.length < loc + 16) return null
    const x = readBytesAsUnsignedBigInt(src, loc, 16)
    return [x < Int128Overflow ? x : x - UInt128Overflow, loc + 16]
  },
  uint256: (src: Uint8Array, loc: number): DecodeResult<bigint> | null => {
    if (src.length < loc + 32) return null
    return [readBytesAsUnsignedBigInt(src, loc, 32), loc + 32]
  },
  int256: (src: Uint8Array, loc: number): DecodeResult<bigint> | null => {
    if (src.length < loc + 32) return null
    const x = readBytesAsUnsignedBigInt(src, loc, 32)
    return [x < Int256Overflow ? x : x - UInt256Overflow, loc + 32]
  },
  string: (src: Uint8Array, loc: number): DecodeResult<string> | null => {
    if (src.length < loc + 1) return null
    const res = readBytesAsUnsignedLEB128(src, loc)
    if (res === null) {
      return null
    }
    const [length, nextLoc] = res
    if (src.length < nextLoc + length) return null
    return [
      TxtDecoder.decode(src.slice(nextLoc, nextLoc + length)),
      nextLoc + length,
    ]
  },
  date: (src: Uint8Array, loc: number): DecodeResult<Date> | null => {
    if (src.length < loc + 2) return null
    const days = readBytesAsUnsignedInt(src, loc, 2)
    const date = new Date(days * DayMillis)
    return [date, loc + 2]
  },
}

export const RowBinaryColumnTypeToDecoder: {
  [key in ColumnType]: TypeDecoder
} = {
  Bool: RowBinaryTypesDecoder.bool,
  UInt8: RowBinaryTypesDecoder.uint8,
  Int8: RowBinaryTypesDecoder.int8,
  UInt16: RowBinaryTypesDecoder.uint16,
  Int16: RowBinaryTypesDecoder.int16,
  UInt32: RowBinaryTypesDecoder.uint32,
  Int32: RowBinaryTypesDecoder.int32,
  UInt64: RowBinaryTypesDecoder.uint64,
  Int64: RowBinaryTypesDecoder.int64,
  UInt128: RowBinaryTypesDecoder.uint128,
  Int128: RowBinaryTypesDecoder.int128,
  UInt256: RowBinaryTypesDecoder.uint256,
  Int256: RowBinaryTypesDecoder.int256,
  String: RowBinaryTypesDecoder.string,
  Date: RowBinaryTypesDecoder.date,
}

export const RowBinaryColumns = {
  decode: (src: Uint8Array): DecodedColumns | DecodeError => {
    const res = readBytesAsUnsignedLEB128(src, 0)
    if (res === null) {
      return { error: 'Not enough data to decode the number of columns' }
    }
    const numColumns = res[0]
    let nextLoc = res[1]
    const names = new Array<string>(numColumns)
    const types = new Array<ColumnType>(numColumns)
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
      const colType = removeLowCardinality(res[0])
      decoders[i] = RowBinaryColumnTypeToDecoder[colType]
      if (decoders[i] === undefined) {
        return {
          error: `Unknown column type ${res[0]} (normalized: ${colType})`,
        }
      }
      types[i] = colType
    }
    return [{ names, types, decoders }, nextLoc]
  },
}

export function removeLowCardinality(colType: string): ColumnType {
  if (colType.startsWith('LowCardinality')) {
    return colType.slice(15, -1) as ColumnType
  }
  return colType as ColumnType
}
