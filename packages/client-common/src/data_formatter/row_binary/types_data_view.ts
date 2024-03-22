// import type { DecodeResult } from './read_bytes'
// import {
//   readBytesAsFloat32,
//   readBytesAsFloat64,
//   readBytesAsUnsignedBigInt,
//   readBytesAsUnsignedInt,
//   readBytesAsUnsignedLEB128,
// } from './read_bytes'
// import {
//   DecimalTypeDecoder,
//   getDecimalIntSize,
//   NullableTypeDecoder,
//   SimpleColumnType,
//   SimpleTypeDecoder,
// } from './types'
//
// const Int8Overflow = 128
// const UInt8Overflow = 256
//
// const Int16Overflow = 32768
// const UInt16Overflow = 65536
//
// const Int32Overflow = 2147483648
// const UInt32Overflow = 4294967296
//
// const Int64Overflow = 9223372036854775808n
// const UInt64Overflow = 18446744073709551616n
//
// const Int128Overflow = 170141183460469231731687303715884105728n
// const UInt128Overflow = 340282366920938463463374607431768211456n
//
// const Int256Overflow =
//   57896044618658097711785492504343953926634992332820282019728792003956564819968n
// const UInt256Overflow =
//   115792089237316195423570985008687907853269984665640564039457584007913129639936n
//
// const DayMillis = 24 * 3600 * 1000
// const TxtDecoder = new TextDecoder()
//
// export type SimpleTypeDecoderDataView<T = unknown> = (
//   src: DataView,
//   loc: number
// ) => DecodeResult<T> | null
//
// export class RowBinaryTypesDecoderDataView {
//   static bool(src: DataView, loc: number): DecodeResult<boolean> | null {
//     if (src.byteLength < loc + 1) return null
//     return [src.getUint8(loc) === 1, loc + 1]
//   }
//   static uint8(src: DataView, loc: number): DecodeResult<number> | null {
//     if (src.byteLength < loc + 1) return null
//     return [src.getUint8(loc), loc + 1]
//   }
//   static int8(src: DataView, loc: number): DecodeResult<number> | null {
//     if (src.byteLength < loc + 1) return null
//     return [src.getInt8(loc), loc + 1]
//   }
//   static uint16(src: DataView, loc: number): DecodeResult<number> | null {
//     if (src.byteLength < loc + 2) return null
//     return [src.getUint16(loc), loc + 2]
//   }
//   static int16(src: DataView, loc: number): DecodeResult<number> | null {
//     if (src.byteLength < loc + 2) return null
//     return [src.getInt16(loc), loc + 2]
//   }
//   static uint32(src: DataView, loc: number): DecodeResult<number> | null {
//     if (src.byteLength < loc + 4) return null
//     return [src.getUint32(loc), loc + 4]
//   }
//   static int32(src: DataView, loc: number): DecodeResult<number> | null {
//     if (src.byteLength < loc + 4) return null
//     return [src.getInt32(loc), loc + 4]
//   }
//   static uint64(src: DataView, loc: number): DecodeResult<bigint> | null {
//     if (src.byteLength < loc + 8) return null
//     return [src.getBigInt64(loc), loc + 8]
//   }
//   static int64(src: DataView, loc: number): DecodeResult<bigint> | null {
//     if (src.byteLength < loc + 8) return null
//     const x = src.getBigInt64(loc)
//     return [x < Int64Overflow ? x : x - UInt64Overflow, loc + 8]
//   }
//   // static uint128(src: DataView, loc: number): DecodeResult<bigint> | null {
//   //   if (src.byteLength < loc + 16) return null
//   //   return [readBytesAsUnsignedBigInt(src, loc, 16), loc + 16]
//   // }
//   // static int128(src: DataView, loc: number): DecodeResult<bigint> | null {
//   //   if (src.byteLength < loc + 16) return null
//   //   const x = readBytesAsUnsignedBigInt(src, loc, 16)
//   //   return [x < Int128Overflow ? x : x - UInt128Overflow, loc + 16]
//   // }
//   // static uint256(src: DataView, loc: number): DecodeResult<bigint> | null {
//   //   if (src.byteLength < loc + 32) return null
//   //   return [readBytesAsUnsignedBigInt(src, loc, 32), loc + 32]
//   // }
//   // static int256(src: DataView, loc: number): DecodeResult<bigint> | null {
//   //   if (src.byteLength < loc + 32) return null
//   //   const x = readBytesAsUnsignedBigInt(src, loc, 32)
//   //   return [x < Int256Overflow ? x : x - UInt256Overflow, loc + 32]
//   // }
//   static float32(src: DataView, loc: number): DecodeResult<number> | null {
//     if (src.byteLength < loc + 4) return null
//     return [src.getFloat32(loc), loc + 4]
//   }
//   static float64(src: DataView, loc: number): DecodeResult<number> | null {
//     if (src.byteLength < loc + 8) return null
//     return [src.getFloat64(loc), loc + 8]
//   }
//   // static string(src: DataView, loc: number): DecodeResult<string> | null {
//   //   if (src.byteLength < loc + 1) return null
//   //   const res = readBytesAsUnsignedLEB128(src.buffer, loc)
//   //   if (res === null) {
//   //     return null
//   //   }
//   //   const [length, nextLoc] = res
//   //   if (src.byteLength < nextLoc + length) return null
//   //   return [
//   //     TxtDecoder.decode(src.buffer.slice(nextLoc, nextLoc + length)),
//   //     nextLoc + length,
//   //   ]
//   // }
//   static date(src: DataView, loc: number): DecodeResult<Date> | null {
//     const res = RowBinaryTypesDecoderDataView.uint16(src, loc)
//     if (res === null) return null
//     return [new Date(res[0] * DayMillis), res[1]]
//   }
//
//   static date32(src: DataView, loc: number): DecodeResult<Date> | null {
//     const res = RowBinaryTypesDecoderDataView.int32(src, loc)
//     if (res === null) return null
//     return [new Date(res[0] * DayMillis), res[1]]
//   }
//   static nullable<T>(
//     baseTypeDecoder: SimpleTypeDecoderDataView<T>
//   ): (src: DataView, loc: number) => DecodeResult<T | null> | null {
//     return (src: DataView, loc: number) => {
//       const res = RowBinaryTypesDecoderDataView.uint8(src, loc)
//       if (res === null) return null
//       if (res[0] === 1) {
//         return [null, res[1]]
//       }
//       return baseTypeDecoder(src, res[1])
//     }
//   }
//   static decimal(
//     precision: number,
//     scale: number
//   ): (src: DataView, loc: number) => DecodeResult<string> | null {
//     const intSize = getDecimalIntSize(precision)
//     let scaleMultiplier: number | bigint
//     if (intSize === 32) {
//       scaleMultiplier = 10 ** scale
//     } else {
//       scaleMultiplier = BigInt(10 ** scale)
//     }
//     return (src: DataView, loc: number) => {
//       if (intSize === 32) {
//         const res = RowBinaryTypesDecoderDataView.int32(src, loc)
//         if (res === null) return null
//         const whole = Math.floor(res[0] / (scaleMultiplier as number))
//         const fractional = res[0] % (scaleMultiplier as number)
//         return [`${whole.toString(10)}.${fractional.toString(10)}`, res[1]]
//       }
//       let res: DecodeResult<bigint> | null
//       if (intSize === 64) {
//         res = RowBinaryTypesDecoderDataView.int64(src, loc)
//       } else if (intSize === 128) {
//         throw new Error('Unsupported int size: 128')
//         // res = RowBinaryTypesDecoderDataView.int128(src, loc)
//       } else if (intSize === 256) {
//         // res = RowBinaryTypesDecoderDataView.int256(src, loc)
//         throw new Error('Unsupported int size: 256')
//       } else {
//         throw new Error(`Unsupported int size: ${intSize}`)
//       }
//       if (res === null) return null
//       const whole = res[0] / (scaleMultiplier as bigint)
//       const fractional = res[0] % (scaleMultiplier as bigint)
//       return [`${whole.toString(10)}.${fractional.toString(10)}`, res[1]]
//     }
//   }
//   // static array<T = unknown>(
//   //   innerDecoder:
//   //     | SimpleTypeDecoder<T>
//   //     | ReturnType<DecimalTypeDecoder>
//   //     | ReturnType<NullableTypeDecoder<T>>,
//   //   dimensions = 0
//   // ): (src: DataView, loc: number) => DecodeResult<Array<unknown>> | null {
//   //   return (src: DataView, loc: number) => {
//   //     const leb128 = readBytesAsUnsignedLEB128(src, loc)
//   //     if (leb128 === null) return null
//   //     const result = new Array(leb128[0])
//   //     if (dimensions === 0) {
//   //       for (let i = 0; i < leb128[0]; i++) {
//   //         const res = innerDecoder(src, leb128[1])
//   //         if (res === null) return null
//   //         result[i] = res[0]
//   //       }
//   //     } else {
//   //       return this.array(innerDecoder, dimensions - 1)(src, leb128[1])
//   //     }
//   //     return null
//   //   }
//   // }
// }
//
// export const RowBinarySimpleDecodersDataView: {
//   [key in
//     | 'Bool'
//     | 'UInt8'
//     | 'Int8'
//     | 'UInt16'
//     | 'Int16'
//     | 'UInt32'
//     | 'Int32'
//     | 'UInt64'
//     | 'Int64'
//     // | 'UInt128'
//     // | 'Int128'
//     // | 'UInt256'
//     // | 'Int256'
//     | 'Float32'
//     | 'Float64'
//     // | 'String'
//     | 'Date'
//     | 'Date32']: SimpleTypeDecoderDataView
// } = {
//   Bool: RowBinaryTypesDecoderDataView.bool,
//   UInt8: RowBinaryTypesDecoderDataView.uint8,
//   Int8: RowBinaryTypesDecoderDataView.int8,
//   UInt16: RowBinaryTypesDecoderDataView.uint16,
//   Int16: RowBinaryTypesDecoderDataView.int16,
//   UInt32: RowBinaryTypesDecoderDataView.uint32,
//   Int32: RowBinaryTypesDecoderDataView.int32,
//   UInt64: RowBinaryTypesDecoderDataView.uint64,
//   Int64: RowBinaryTypesDecoderDataView.int64,
//   // UInt128: RowBinaryTypesDecoderDataView.uint128,
//   // Int128: RowBinaryTypesDecoderDataView.int128,
//   // UInt256: RowBinaryTypesDecoderDataView.uint256,
//   // Int256: RowBinaryTypesDecoderDataView.int256,
//   Float32: RowBinaryTypesDecoderDataView.float32,
//   Float64: RowBinaryTypesDecoderDataView.float64,
//   // String: RowBinaryTypesDecoderDataView.string,
//   Date: RowBinaryTypesDecoderDataView.date,
//   Date32: RowBinaryTypesDecoderDataView.date32,
// }
