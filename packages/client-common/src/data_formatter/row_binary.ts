export type ColumnType =
  | 'Bool'
  | 'UInt8'
  | 'Int8'
  | 'UInt16'
  | 'Int16'
  | 'UInt32'
  | 'Int32'
  // | 'UInt64'
  // | 'Int64'
  // | 'UInt128'
  // | 'Int128'
  // | 'UInt256'
  // | 'Int256'
  | 'String'

export type TypeDecoder<T = unknown> = (
  src: Uint8Array,
  loc: number
) => DecodeResult<T> | null

export type DecodeResult<T> = [T, number]
export type DecodeError = { error: string }
export type DecodedColumns = DecodeResult<{
  names: string[]
  types: ColumnType[]
  decoders: TypeDecoder[]
}>

export const RowBinaryTypesDecoder = {
  bool: (src: Uint8Array, loc: number): DecodeResult<boolean> | null => {
    //// [1,2,3,4] - len 4; max loc 3
    if (src.length < loc + 1) return null
    const x = src[loc] === 1
    return [x, loc + 1]
  },
  uint8: (src: Uint8Array, loc: number): DecodeResult<number> | null => {
    if (src.length < loc + 1) return null
    const x = src[loc]
    return [x, loc + 1]
  },
  int8: (src: Uint8Array, loc: number): DecodeResult<number> | null => {
    if (src.length < loc + 1) return null
    const x = src[loc]
    return [x, loc + 1]
  },
  uint16: (src: Uint8Array, loc: number): DecodeResult<number> | null => {
    if (src.length < loc + 2) return null
    const x = readBytesAsInt(src, loc, 2, false)
    return [x, loc + 2]
  },
  int16: (src: Uint8Array, loc: number): DecodeResult<number> | null => {
    if (src.length < loc + 2) return null
    const x = readBytesAsInt(src, loc, 2, true)
    return [x, loc + 2]
  },
  uint32: (src: Uint8Array, loc: number): DecodeResult<number> | null => {
    if (src.length < loc + 4) return null
    const x = readBytesAsInt(src, loc, 4, false)
    return [x, loc + 4]
  },
  int32: (src: Uint8Array, loc: number): DecodeResult<number> | null => {
    if (src.length < loc + 4) return null
    const x = readBytesAsInt(src, loc, 4, true)
    return [x, loc + 4]
  },
  // uint64: (src: Uint8Array, loc: number): DecodeResult<BigInt> => {
  //   return [readBytesAsUnsignedBigInt(src, loc, 8), loc + 8]
  // },
  // int64: (src: Uint8Array, loc: number): DecodeResult<BigInt> => {
  //   return [readBytesAsUnsignedBigInt(src, loc, 8), loc + 8]
  // },
  // uint128: (src: Uint8Array, loc: number): DecodeResult<BigInt> => {
  //   return [readBytesAsUnsignedBigInt(src, loc, 16), loc + 16]
  // },
  // int128: (src: Uint8Array, loc: number): DecodeResult<BigInt> => {
  //   return [readBytesAsUnsignedBigInt(src, loc, 16), loc + 16]
  // },
  // uint256: (src: Uint8Array, loc: number): DecodeResult<BigInt> => {
  //   return [readBytesAsUnsignedBigInt(src, loc, 32), loc + 32]
  // },
  // int256: (src: Uint8Array, loc: number): DecodeResult<BigInt> => {
  //   return [readBytesAsUnsignedBigInt(src, loc, 32), loc + 32]
  // },
  string: (src: Uint8Array, loc: number): DecodeResult<string> | null => {
    return readLEB128String(src, loc)
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
  // UInt64: RowBinaryTypesDecoder.uint64,
  // Int64: RowBinaryTypesDecoder.int64,
  // UInt128: RowBinaryTypesDecoder.uint128,
  // Int128: RowBinaryTypesDecoder.int128,
  // UInt256: RowBinaryTypesDecoder.uint256,
  // Int256: RowBinaryTypesDecoder.int256,
  String: RowBinaryTypesDecoder.string,
}

export const RowBinaryColumns = {
  decode: (src: Uint8Array): DecodedColumns | DecodeError => {
    const res = readLEB128(src, 0)
    const numColumns = res[0]
    let nextLoc = res[1]
    console.log(`Total columns: ${numColumns}`)
    const names = new Array<string>(numColumns)
    const types = new Array<ColumnType>(numColumns)
    const decoders: TypeDecoder[] = new Array<TypeDecoder>(numColumns)
    for (let i = 0; i < numColumns; i++) {
      const res = readLEB128String(src, nextLoc)! // FIXME non-null assertion
      nextLoc = res[1]
      names[i] = res[0]
    }
    for (let i = 0; i < numColumns; i++) {
      const res = readLEB128String(src, nextLoc)! // FIXME non-null assertion
      nextLoc = res[1]
      decoders[i] = RowBinaryColumnTypeToDecoder[res[0] as ColumnType]
      if (decoders[i] === undefined) {
        return { error: `Unknown column type ${res[0]}` }
      }
      types[i] = res[0] as ColumnType
    }
    return [{ names, types, decoders }, nextLoc]
  },
}

export function readLEB128(src: Uint8Array, loc: number): DecodeResult<number> {
  let result = 0
  let shift = 0
  let ix = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const byte = src[loc + ix]
    ix++
    result |= (byte & 0x7f) << shift
    shift += 7
    if ((0x80 & byte) === 0) {
      if (shift < 32 && (byte & 0x40) !== 0) {
        return [result | (~0 << shift), loc + ix]
      }
      return [result, loc + ix]
    }
  }
}

export function readLEB128String(
  src: Uint8Array,
  loc: number
): DecodeResult<string> | null {
  // console.log(`Decoding string at loc ${loc}, src len: ${src.length}`)
  if (src.length < loc + 1) return null
  const [length, nextLoc] = readLEB128(src, loc)
  // console.log(`Got next loc for string, next loc ${nextLoc}, len: ${length}, src len: ${src.length}`)
  if (src.length < nextLoc + length) return null
  return [src.slice(nextLoc, nextLoc + length).toString(), nextLoc + length]
}

export function readBytesAsInt(
  src: Uint8Array,
  loc: number,
  bytes: 2 | 4, // (U)Int16 | (U)Int32
  signed: boolean
): number {
  let result = 0
  for (let i = 0; i < bytes; i++) {
    result |= src[loc + i] << (8 * i)
  }
  result = result >>> 0
  const max = 2 ** (bytes * 8)
  if (signed && result > max / 2 - 1) {
    return result - max
  }
  return result
}

export function readBytesAsUnsignedBigInt(
  src: Uint8Array,
  loc: number,
  bytes: 8 | 16 | 32 // (U)Int64 | (U)Int128 | (U)Int256
): BigInt {
  let result = 0n
  for (let i = bytes - 1; i >= 0; i--) {
    // console.log(src[loc + i])
    result = (result << 8n) + BigInt(src[loc + i])
  }
  console.log(
    `(BigInt) Decoded ${bytes} bytes ${src
      .slice(loc, loc + bytes)
      .toString()} into ${result}`
  )
  return result
}

export function readBytesAsSignedBigInt(
  src: Uint8Array,
  loc: number,
  bytes: 8 | 16 | 32 // (U)Int64 | (U)Int128 | (U)Int256
): BigInt {
  let result = 0n
  for (let i = bytes / 4 - 1; i >= 0; i--) {
    const dec = readBytesAsInt(src, loc + i * 4, 4, true)
    console.log(`Decoded: ${dec}`)
    result += BigInt(dec)
  }
  // console.log(`(BigInt) Decoded ${bytes} bytes into ${result}`)
  return result
}
