import {
  DecodeResult,
  readBytesAsFloat32,
  readBytesAsFloat64,
  readBytesAsUnsignedBigInt,
  readBytesAsUnsignedInt,
  readBytesAsUnsignedLEB128,
} from './read_bytes'

export type SimpleColumnType =
  /** {@link SimpleTypeDecoder} */
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
export type ColumnType =
  | SimpleColumnType
  /** {@link DecimalTypeDecoder} */
  | 'Decimal'
  /** {@link ArrayTypeDecoder} */
  | 'Array'

export type SimpleTypeDecoder<T = unknown> = (
  src: Uint8Array,
  loc: number
) => DecodeResult<T> | null
export type DecimalTypeDecoder = (
  precision: number,
  scale: number
) => SimpleTypeDecoder<string>
export type NullableTypeDecoder<T> = (
  baseTypeDecoder: SimpleTypeDecoder<T> | DecimalTypeDecoder
) => SimpleTypeDecoder<T>
export type ArrayTypeDecoder<T = unknown> = (
  innerDecoder: SimpleTypeDecoder<T>,
  dimensions: number
) => SimpleTypeDecoder<T[]>
export type TypeDecoder<T = unknown> =
  | SimpleTypeDecoder<T>
  | DecimalTypeDecoder
  | ArrayTypeDecoder<T>

// TBD: nested key type safety?
export type MapTypeDecoder<Key, Value> = (
  keyDecoder: SimpleTypeDecoder<Key>,
  valueDecoder:
    | SimpleTypeDecoder<Value>
    | ArrayTypeDecoder<Value>
    | MapTypeDecoder<unknown, unknown>
) => SimpleTypeDecoder<Map<string, unknown>>

// type DateMapper<T> = (days: number) => T

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

// const DecimalScaleMultipliersNumber: Record<number, number> = {}
// for (let i = 0; i < 10; i++) {
//   DecimalScaleMultipliersNumber[i] = 10 ** i
// }
// const DecimalScaleMultipliersBigInt: Record<number, bigint> = {}
// for (let i = 0; i < 77; i++) {
//   DecimalScaleMultipliersBigInt[i] = BigInt(10 ** i)
// }
// console.log(DecimalScaleMultipliers)

const DayMillis = 24 * 3600 * 1000
const TxtDecoder = new TextDecoder()

export class RowBinaryTypesDecoder {
  static bool(src: Uint8Array, loc: number): DecodeResult<boolean> | null {
    if (src.length < loc + 1) return null
    return [src[loc] === 1, loc + 1]
  }
  static uint8(src: Uint8Array, loc: number): DecodeResult<number> | null {
    if (src.length < loc + 1) return null
    return [src[loc], loc + 1]
  }
  static int8(src: Uint8Array, loc: number): DecodeResult<number> | null {
    if (src.length < loc + 1) return null
    const x = src[loc]
    return [x < Int8Overflow ? x : x - UInt8Overflow, loc + 1]
  }
  static uint16(src: Uint8Array, loc: number): DecodeResult<number> | null {
    if (src.length < loc + 2) return null
    return [readBytesAsUnsignedInt(src, loc, 2), loc + 2]
  }
  static int16(src: Uint8Array, loc: number): DecodeResult<number> | null {
    if (src.length < loc + 2) return null
    const x = readBytesAsUnsignedInt(src, loc, 2)
    return [x < Int16Overflow ? x : x - UInt16Overflow, loc + 2]
  }
  static uint32(src: Uint8Array, loc: number): DecodeResult<number> | null {
    if (src.length < loc + 4) return null
    return [readBytesAsUnsignedInt(src, loc, 4), loc + 4]
  }
  static int32(src: Uint8Array, loc: number): DecodeResult<number> | null {
    if (src.length < loc + 4) return null
    const x = readBytesAsUnsignedInt(src, loc, 4)
    return [x < Int32Overflow ? x : x - UInt32Overflow, loc + 4]
  }
  static uint64(src: Uint8Array, loc: number): DecodeResult<bigint> | null {
    if (src.length < loc + 8) return null
    return [readBytesAsUnsignedBigInt(src, loc, 8), loc + 8]
  }
  static int64(src: Uint8Array, loc: number): DecodeResult<bigint> | null {
    if (src.length < loc + 8) return null
    const x = readBytesAsUnsignedBigInt(src, loc, 8)
    return [x < Int64Overflow ? x : x - UInt64Overflow, loc + 8]
  }
  static uint128(src: Uint8Array, loc: number): DecodeResult<bigint> | null {
    if (src.length < loc + 16) return null
    return [readBytesAsUnsignedBigInt(src, loc, 16), loc + 16]
  }
  static int128(src: Uint8Array, loc: number): DecodeResult<bigint> | null {
    if (src.length < loc + 16) return null
    const x = readBytesAsUnsignedBigInt(src, loc, 16)
    return [x < Int128Overflow ? x : x - UInt128Overflow, loc + 16]
  }
  static uint256(src: Uint8Array, loc: number): DecodeResult<bigint> | null {
    if (src.length < loc + 32) return null
    return [readBytesAsUnsignedBigInt(src, loc, 32), loc + 32]
  }
  static int256(src: Uint8Array, loc: number): DecodeResult<bigint> | null {
    if (src.length < loc + 32) return null
    const x = readBytesAsUnsignedBigInt(src, loc, 32)
    return [x < Int256Overflow ? x : x - UInt256Overflow, loc + 32]
  }
  static float32(src: Uint8Array, loc: number): DecodeResult<number> | null {
    if (src.length < loc + 4) return null
    const f32 = readBytesAsFloat32(src, loc)
    // console.log(f32)
    return [f32, loc + 4]
  }
  static float64(src: Uint8Array, loc: number): DecodeResult<number> | null {
    if (src.length < loc + 8) return null
    return [readBytesAsFloat64(src, loc), loc + 8]
  }
  static string(src: Uint8Array, loc: number): DecodeResult<string> | null {
    if (src.length < loc + 1) return null
    const res = readBytesAsUnsignedLEB128(src, loc)
    if (res === null) {
      return null
    }
    const [length, nextLoc] = res
    if (src.length < nextLoc + length) return null
    return [
      TxtDecoder.decode(src.subarray(nextLoc, nextLoc + length)),
      nextLoc + length,
    ]
  }
  static date(src: Uint8Array, loc: number): DecodeResult<Date> | null {
    const res = RowBinaryTypesDecoder.uint16(src, loc)
    if (res === null) return null
    return [new Date(res[0] * DayMillis), res[1]]
  }
  static date32(src: Uint8Array, loc: number): DecodeResult<Date> | null {
    const res = RowBinaryTypesDecoder.int32(src, loc)
    if (res === null) return null
    return [new Date(res[0] * DayMillis), res[1]]
  }
  static nullable<T>(
    baseTypeDecoder: SimpleTypeDecoder<T>
  ): (src: Uint8Array, loc: number) => DecodeResult<T | null> | null {
    return (src: Uint8Array, loc: number) => {
      const res = RowBinaryTypesDecoder.uint8(src, loc)
      if (res === null) return null
      if (res[0] === 1) {
        return [null, res[1]]
      }
      return baseTypeDecoder(src, res[1])
    }
  }
  // static decimal(
  //   precision: number,
  //   scale: number
  // ): (src: Uint8Array, loc: number) => DecodeResult<string> | null {
  //   const intSize = getDecimalIntSize(precision)
  //   let scaleMultiplier: number | bigint
  //   if (intSize === 32) {
  //     scaleMultiplier = 10 ** scale
  //   } else {
  //     scaleMultiplier = BigInt(10 ** scale)
  //   }
  //   // const scaleMultiplier =
  //   //   intSize === 32
  //   //     ? DecimalScaleMultipliersNumber[scale]
  //   //     : DecimalScaleMultipliersBigInt[scale]
  //   return (src: Uint8Array, loc: number) => {
  //     if (intSize === 32) {
  //       const res = RowBinaryTypesDecoder.int32(src, loc)
  //       if (res === null) return null
  //       const whole = ~~(res[0] / (scaleMultiplier as number))
  //       const fractional = res[0] % (scaleMultiplier as number)
  //       return [`${whole.toString(10)}.${fractional.toString(10)}`, res[1]]
  //     }
  //     let res: DecodeResult<bigint> | null
  //     if (intSize === 64) {
  //       if (src.length < loc + 8) return null
  //       const x = readBytesAsUnsignedBigInt(src, loc, 8)
  //       res = [x < Int64Overflow ? x : x - UInt64Overflow, loc + 8]
  //     } else if (intSize === 128) {
  //       res = RowBinaryTypesDecoder.int128(src, loc)
  //     } else if (intSize === 256) {
  //       res = RowBinaryTypesDecoder.int256(src, loc)
  //     } else {
  //       throw new Error(`Unsupported int size: ${intSize}`)
  //     }
  //     if (res === null) return null
  //     const whole = res[0] / (scaleMultiplier as bigint)
  //     const fractional = res[0] % (scaleMultiplier as bigint)
  //     return [`${whole.toString(10)}.${fractional.toString(10)}`, res[1]]
  //   }
  // }
  static decimal32(
    scale: number
  ): (src: Uint8Array, loc: number) => DecodeResult<string> | null {
    const scaleMultiplier = 10 ** scale
    return (src: Uint8Array, loc: number) => {
      const res = RowBinaryTypesDecoder.int32(src, loc)
      if (res === null) return null
      const whole = ~~(res[0] / (scaleMultiplier as number))
      const fractional = res[0] % (scaleMultiplier as number)
      return [`${whole.toString(10)}.${fractional.toString(10)}`, res[1]]
    }
  }
  static decimal64(
    scale: number
  ): (src: Uint8Array, loc: number) => DecodeResult<string> | null {
    return (src: Uint8Array, loc: number) => {
      const res = RowBinaryTypesDecoder.int64(src, loc)
      if (res === null) return null
      // avoid any bigint math here, it's super slow
      const str = res[0].toString()
      const dotIndex = str.length - scale
      const whole = str.slice(0, dotIndex)
      const fractional = str.slice(dotIndex)
      return [`${whole}.${fractional}`, res[1]]
    }
  }
  static array<T = unknown>(
    innerDecoder:
      | SimpleTypeDecoder<T>
      | ReturnType<DecimalTypeDecoder>
      | ReturnType<NullableTypeDecoder<T>>,
    dimensions = 0
  ): (src: Uint8Array, loc: number) => DecodeResult<Array<unknown>> | null {
    return (src: Uint8Array, loc: number) => {
      const leb128 = readBytesAsUnsignedLEB128(src, loc)
      if (leb128 === null) return null
      const result = new Array(leb128[0])
      if (dimensions === 0) {
        for (let i = 0; i < leb128[0]; i++) {
          const res = innerDecoder(src, leb128[1])
          if (res === null) return null
          result[i] = res[0]
        }
      } else {
        return this.array(innerDecoder, dimensions - 1)(src, leb128[1])
      }
      return null
    }
  }
}

export function getDecimalIntSize(precision: number): 32 | 128 | 64 | 256 {
  if (precision < 10) return 32
  if (precision < 19) return 64
  if (precision < 39) return 128
  return 256
}

export const RowBinarySimpleDecoders: {
  [key in SimpleColumnType]: SimpleTypeDecoder
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
