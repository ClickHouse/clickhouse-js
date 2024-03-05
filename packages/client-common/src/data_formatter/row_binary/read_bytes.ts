// Decoded value + the next index to scan from
export type DecodeResult<T> = [T, number]

export function readBytesAsUnsignedLEB128(
  src: Uint8Array,
  loc: number
): DecodeResult<number> | null {
  let result = 0
  let shift = 0
  let ix = 0
  let byte: number
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (src.length < loc + ix + 1) {
      return null
    }
    byte = src[loc + ix++]
    result |= (byte & 0x7f) << shift
    if (byte >> 7 === 0) {
      return [result, loc + ix]
    }
    shift += 7
  }
}

export function readBytesAsUnsignedInt(
  src: Uint8Array,
  loc: number,
  bytes: 2 | 4 // (U)Int16 | (U)Int32
): number {
  let result = 0
  for (let i = bytes - 1; i >= 0; i--) {
    result = (result << 8) + src[loc + i]
  }
  return result >>> 0
}

export function readBytesAsUnsignedBigInt(
  src: Uint8Array,
  loc: number,
  bytes: 8 | 16 | 32 // (U)Int64 | (U)Int128 | (U)Int256
): bigint {
  let result = 0n
  for (let i = bytes - 1; i >= 0; i--) {
    result = (result << 8n) + BigInt(src[loc + i])
  }
  return result
}
