type DecodeResult<T> = [T, number]

export class RowBinaryDecoder {
  static columns(
    src: Uint8Array
  ): DecodeResult<{ names: string[]; types: string[] }> {
    const res = readLEB128(src, 0)
    const numColumns = res[0]
    let nextLoc = res[1]
    console.log(`Total columns: ${numColumns}`)
    const names = new Array<string>(numColumns)
    const types = new Array<string>(numColumns)
    for (let i = 0; i < numColumns; i++) {
      const res = readLEB128String(src, nextLoc)
      nextLoc = res[1]
      names[i] = res[0]
    }
    for (let i = 0; i < numColumns; i++) {
      const res = readLEB128String(src, nextLoc)
      nextLoc = res[1]
      types[i] = res[0]
    }
    return [{ names, types }, nextLoc]
  }
  static int8(src: Uint8Array, loc: number): DecodeResult<number> {
    const x = src[loc]
    console.log(`Got number: ${x}`)
    return x < 128 ? [x, loc + 1] : [x - 256, loc + 1]
  }
  static string(src: Uint8Array, loc: number): DecodeResult<string> {
    return readLEB128String(src, loc)
  }
}

function readLEB128(src: Uint8Array, loc: number): DecodeResult<number> {
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

function readLEB128String(src: Uint8Array, loc: number): DecodeResult<string> {
  const [length, nextLoc] = readLEB128(src, loc)
  return [src.slice(nextLoc, nextLoc + length).toString(), nextLoc + length]
}
