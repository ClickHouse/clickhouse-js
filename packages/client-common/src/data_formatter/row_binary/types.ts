import type { DecodeResult } from './read_bytes'
import {
  readBytesAsFloat32,
  readBytesAsFloat64,
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
  | 'Float32'
  | 'Float64'
  | 'String'
  | 'Date'
  | 'Date32'

export type TypeDecoder<T = unknown> = (
  src: Uint8Array,
  loc: number
) => DecodeResult<T> | null

export type DecodeError = { error: string }
export type DecodedColumnType = {
  dbType: string
  columnType: ColumnType
  isNullable: boolean
  isLowCardinality: boolean
}

type DateMapper<T> = (days: number) => T

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
  float32: (src: Uint8Array, loc: number): DecodeResult<number> | null => {
    if (src.length < loc + 4) return null
    return [readBytesAsFloat32(src, loc), loc + 4]
  },
  float64: (src: Uint8Array, loc: number): DecodeResult<number> | null => {
    if (src.length < loc + 8) return null
    return [readBytesAsFloat64(src, loc), loc + 8]
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
    const res = RowBinaryTypesDecoder.uint16(src, loc)
    if (res === null) return null
    return [new Date(res[0] * DayMillis), res[1]]
  },
  date32: (src: Uint8Array, loc: number): DecodeResult<Date> | null => {
    const res = RowBinaryTypesDecoder.int32(src, loc)
    if (res === null) return null
    return [new Date(res[0] * DayMillis), res[1]]
  },
  nullable:
    <T>(baseTypeDecoder: TypeDecoder<T>) =>
    (src: Uint8Array, loc: number): DecodeResult<T | null> | null => {
      const res = RowBinaryTypesDecoder.uint8(src, loc)
      if (res === null) return null
      if (res[0] === 1) {
        return [null, res[1]]
      }
      return baseTypeDecoder(src, res[1])
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
  Float32: RowBinaryTypesDecoder.float32,
  Float64: RowBinaryTypesDecoder.float64,
  String: RowBinaryTypesDecoder.string,
  Date: RowBinaryTypesDecoder.date,
  Date32: RowBinaryTypesDecoder.date32,
}
