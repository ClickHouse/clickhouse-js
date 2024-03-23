// Decoded value + the next index to scan from
export type DecodeResult<T> = [T, number]

// May return null since we cannot determine how many bytes we need to read in advance
export function readBytesAsUnsignedLEB128(
  src: Buffer,
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
