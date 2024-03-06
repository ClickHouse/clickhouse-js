import {
  readBytesAsFloat32,
  readBytesAsUnsignedBigInt,
  readBytesAsUnsignedInt,
} from '../../src/data_formatter'

fdescribe('RowBinary read bytes', () => {
  describe('Unsigned integers', () => {
    it('should decode UInt16', async () => {
      const args: [Uint8Array, number][] = [
        [new Uint8Array([0x00, 0x00]), 0],
        [new Uint8Array([0x01, 0x00]), 1],
        [new Uint8Array([0x02, 0x00]), 2],
        [new Uint8Array([0x10, 0x00]), 16],
        [new Uint8Array([0xff, 0x00]), 255],
        [new Uint8Array([0xff, 0xff]), 65535],
        [new Uint8Array([0x00, 0x80]), 32768],
      ]
      args.forEach(([src, expected]) => {
        expect(readBytesAsUnsignedInt(src, 0, 2))
          .withContext(ctx(src, expected))
          .toBe(expected)
      })
    })
    it('should decode UInt32', async () => {
      const args: [Uint8Array, number][] = [
        [new Uint8Array([0x00, 0x00, 0x00, 0x00]), 0],
        [new Uint8Array([0x01, 0x00, 0x00, 0x00]), 1],
        [new Uint8Array([0x02, 0x00, 0x00, 0x00]), 2],
        [new Uint8Array([0x10, 0x00, 0x00, 0x00]), 16],
        [new Uint8Array([0xff, 0x00, 0x00, 0x00]), 255],
        [new Uint8Array([0xff, 0xff, 0x00, 0x00]), 65535],
        [new Uint8Array([0xff, 0xff, 0xff, 0x00]), 16777215],
        [new Uint8Array([0xff, 0xff, 0xff, 0x7f]), 2147483647],
        [new Uint8Array([0xff, 0xff, 0xff, 0xff]), 4294967295],
        [new Uint8Array([0x00, 0x00, 0x00, 0x80]), 2147483648],
      ]
      args.forEach(([src, expected]) => {
        expect(readBytesAsUnsignedInt(src, 0, 4))
          .withContext(ctx(src, expected))
          .toBe(expected)
      })
    })
  })

  describe('Unsigned big integers', () => {
    it('should decode UInt64', async () => {
      const args: [Uint8Array, bigint][] = [
        [new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), 0n],
        [new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), 1n],
        [new Uint8Array([0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), 2n],
        [
          new Uint8Array([0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
          255n,
        ],
        [
          new Uint8Array([0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
          65535n,
        ],
        [
          new Uint8Array([0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00]),
          16777215n,
        ],
        [
          new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00]),
          4294967295n,
        ],
        [
          new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00]),
          1099511627775n,
        ],
        [
          new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00, 0x00]),
          281474976710655n,
        ],
        [
          new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00]),
          72057594037927935n,
        ],
        [
          new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
          18446744073709551615n,
        ],
      ]

      args.forEach(([src, expected]) => {
        expect(readBytesAsUnsignedBigInt(src, 0, 8))
          .withContext(ctx(src, expected))
          .toBe(expected)
      })
    })
  })

  fdescribe('Floats', () => {
    it('should decode Float32', async () => {
      const args: [Uint8Array, number][] = [
        [new Uint8Array([0x00, 0x00, 0x00, 0x00]), 0],
        // some reference values from a random dataset (not 100% matching the CH output, because floats)
        [new Uint8Array([151, 136, 46, 6]), 3.2826113095459874e-35],
        [new Uint8Array([176, 183, 118, 153]), -1.2754997313209913e-23],
        [new Uint8Array([114, 233, 40, 161]), -5.72295763540352e-19],
        [new Uint8Array([112, 205, 62, 233]), -1.4416628555694005e25],
        [new Uint8Array([43, 253, 113, 82]), 259833643008],
        [new Uint8Array([165, 173, 250, 112]), 6.206494065007942e29],
        [new Uint8Array([175, 228, 124, 108]), 1.2229169371247749e27],
      ]
      args.forEach(([src, expected]) => {
        expect(readBytesAsFloat32(src, 0))
          .withContext(ctx(src, expected))
          .toBe(expected)
      })
    })
  })

  function ctx(src: Uint8Array, expected: number | bigint) {
    return `Expected ${src.toString()} to be decoded as ${expected}`
  }
})
