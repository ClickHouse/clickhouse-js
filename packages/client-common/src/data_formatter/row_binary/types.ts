import type { Buffer } from 'buffer'
import type { DecodeResult } from './read_bytes'
import { readBytesAsUnsignedLEB128 } from './read_bytes'

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
  // | 'UInt128'
  // | 'Int128'
  // | 'UInt256'
  // | 'Int256'
  | 'Float32'
  | 'Float64'
  | 'String'
  | 'Date'
  | 'Date32'

export type SimpleTypeDecoder<T = unknown> = (
  src: Buffer,
  loc: number,
) => DecodeResult<T> | null
export type DecimalTypeDecoder = (
  precision: number,
  scale: number,
) => SimpleTypeDecoder<string>
export type NullableTypeDecoder<T> = (
  baseTypeDecoder: SimpleTypeDecoder<T> | DecimalTypeDecoder,
) => SimpleTypeDecoder<T>
export type ArrayTypeDecoder<T = unknown> = (
  innerDecoder: SimpleTypeDecoder<T>,
  dimensions: number,
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
    | MapTypeDecoder<unknown, unknown>,
) => SimpleTypeDecoder<Map<string, unknown>>

const DayMillis = 24 * 3600 * 1000

export class RowBinaryTypesDecoder {
  static bool(src: Buffer, loc: number): DecodeResult<boolean> | null {
    if (src.length < loc + 1) return null
    return [src[loc] === 1, loc + 1]
  }
  static uint8(src: Buffer, loc: number): DecodeResult<number> | null {
    if (src.length < loc + 1) return null
    return [src[loc], loc + 1]
  }
  static int8(src: Buffer, loc: number): DecodeResult<number> | null {
    if (src.length < loc + 1) return null
    return [src.readInt8(loc), loc + 1]
  }
  static uint16(src: Buffer, loc: number): DecodeResult<number> | null {
    if (src.length < loc + 2) return null
    return [src.readUint16LE(loc), loc + 2]
  }
  static int16(src: Buffer, loc: number): DecodeResult<number> | null {
    if (src.length < loc + 2) return null
    return [src.readInt16LE(loc), loc + 2]
  }
  static uint32(src: Buffer, loc: number): DecodeResult<number> | null {
    if (src.length < loc + 4) return null
    return [src.readUInt32LE(loc), loc + 4]
  }
  static int32(src: Buffer, loc: number): DecodeResult<number> | null {
    if (src.length < loc + 4) return null
    return [src.readInt32LE(loc), loc + 4]
  }
  static uint64(src: Buffer, loc: number): DecodeResult<bigint> | null {
    if (src.length < loc + 8) return null
    return [src.readBigUInt64LE(loc), loc + 8]
  }
  static int64(src: Buffer, loc: number): DecodeResult<bigint> | null {
    if (src.length < loc + 8) return null
    return [src.readBigInt64LE(loc), loc + 8]
  }
  // static uint128(src: Buffer, loc: number): DecodeResult<bigint> | null {
  //   if (src.length < loc + 16) return null
  //   return [readBytesAsUnsignedBigInt(src, loc, 16), loc + 16]
  // }
  // static int128(src: Buffer, loc: number): DecodeResult<bigint> | null {
  //   if (src.length < loc + 16) return null
  //   const x = readBytesAsUnsignedBigInt(src, loc, 16)
  //   return [x < Int128Overflow ? x : x - UInt128Overflow, loc + 16]
  // }
  // static uint256(src: Buffer, loc: number): DecodeResult<bigint> | null {
  //   if (src.length < loc + 32) return null
  //   return [readBytesAsUnsignedBigInt(src, loc, 32), loc + 32]
  // }
  // static int256(src: Buffer, loc: number): DecodeResult<bigint> | null {
  //   if (src.length < loc + 32) return null
  //   const x = readBytesAsUnsignedBigInt(src, loc, 32)
  //   return [x < Int256Overflow ? x : x - UInt256Overflow, loc + 32]
  // }
  static float32(src: Buffer, loc: number): DecodeResult<number> | null {
    if (src.length < loc + 4) return null
    // console.log(f32)
    return [src.readFloatLE(loc), loc + 4]
  }
  static float64(src: Buffer, loc: number): DecodeResult<number> | null {
    if (src.length < loc + 8) return null
    return [src.readDoubleLE(loc), loc + 8]
  }
  static string(src: Buffer, loc: number): DecodeResult<string> | null {
    if (src.length < loc + 1) return null
    const res = readBytesAsUnsignedLEB128(src, loc)
    if (res === null) {
      return null
    }
    const [length, nextLoc] = res
    const endLoc = nextLoc + length
    if (src.length < endLoc) return null
    return [src.toString('utf8', nextLoc, endLoc), endLoc]
  }
  static date(src: Buffer, loc: number): DecodeResult<Date> | null {
    if (src.length < loc + 2) return null
    const daysSinceEpoch = src.readUInt16LE(loc)
    return [new Date(daysSinceEpoch * DayMillis), loc + 2]
  }
  static date32(src: Buffer, loc: number): DecodeResult<Date> | null {
    if (src.length < loc + 4) return null
    const daysBeforeOrSinceEpoch = src.readInt32LE(loc)
    return [new Date(daysBeforeOrSinceEpoch * DayMillis), loc + 4]
  }
  static nullable<T>(
    baseTypeDecoder: SimpleTypeDecoder<T>,
  ): (src: Buffer, loc: number) => DecodeResult<T | null> | null {
    return (src: Buffer, loc: number) => {
      if (src.length < loc + 1) return null
      const isNull = src[loc]
      if (isNull === 1) {
        return [null, loc + 1]
      }
      return baseTypeDecoder(src, loc + 1)
    }
  }
  static enum8(
    values: Map<number, string>,
  ): (src: Buffer, loc: number) => DecodeResult<string> | null {
    return (src: Buffer, loc: number) => {
      if (src.length < loc + 1) return null
      const index = src.readUInt8(loc)
      const value = values.get(index)! // TODO: handle missing values
      return [value, loc + 1]
    }
  }
  static enum16(
    values: Map<number, string>,
  ): (src: Buffer, loc: number) => DecodeResult<string> | null {
    return (src: Buffer, loc: number) => {
      if (src.length < loc + 2) return null
      const index = src.readUInt16LE(loc)
      const value = values.get(index)! // TODO: handle missing values
      return [value, loc + 2]
    }
  }
  // static decimal(
  //   precision: number,
  //   scale: number
  // ): (src: Buffer, loc: number) => DecodeResult<string> | null {
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
  //   return (src: Buffer, loc: number) => {
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
    scale: number,
    mapper?: <T>(whole: number, fractional: number) => T,
  ): (src: Buffer, loc: number) => DecodeResult<string> | null {
    const scaleMultiplier = 10 ** scale
    return (src: Buffer, loc: number) => {
      if (src.length < loc + 4) return null
      const fullDecimal32 = src.readInt32LE(loc)
      const whole = ~~(fullDecimal32 / (scaleMultiplier as number))
      const fractional = fullDecimal32 % (scaleMultiplier as number)
      if (mapper !== undefined) {
        return [mapper(whole, fractional), loc + 4]
      }
      return [`${whole.toString(10)}.${fractional.toString(10)}`, loc + 4]
    }
  }
  static decimal64(
    scale: number,
  ): (src: Buffer, loc: number) => DecodeResult<string> | null {
    // const scaleMultiplier = BigInt(10) ** BigInt(scale)
    return (src: Buffer, loc: number) => {
      if (src.length < loc + 8) return null
      const fullDecimal64 = src.readBigInt64LE(loc)
      // Avoid BigInt math; it's slower than just dealing with a string
      const str = fullDecimal64.toString(10)
      if (scale >= str.length) {
        return [`0.${str}`, loc + 8]
      } else {
        const dotIndex = str.length - scale
        return [`${str.slice(0, dotIndex)}.${str.slice(dotIndex)}`, loc + 8]
      }
    }
  }
  static array<T = unknown>(
    innerDecoder:
      | SimpleTypeDecoder<T>
      | ReturnType<DecimalTypeDecoder>
      | ReturnType<NullableTypeDecoder<T>>,
    dimensions = 0,
  ): (src: Buffer, loc: number) => DecodeResult<Array<unknown>> | null {
    return (src: Buffer, loc: number) => {
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
  // UInt128: RowBinaryTypesDecoder.uint128,
  // Int128: RowBinaryTypesDecoder.int128,
  // UInt256: RowBinaryTypesDecoder.uint256,
  // Int256: RowBinaryTypesDecoder.int256,
  Float32: RowBinaryTypesDecoder.float32,
  Float64: RowBinaryTypesDecoder.float64,
  String: RowBinaryTypesDecoder.string,
  Date: RowBinaryTypesDecoder.date,
  Date32: RowBinaryTypesDecoder.date32,
}
