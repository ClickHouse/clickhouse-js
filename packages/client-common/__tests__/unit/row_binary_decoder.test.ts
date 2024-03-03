import {
  readBytesAsInt,
  readBytesAsSignedBigInt,
  readBytesAsUnsignedBigInt,
} from '../../src/data_formatter'

describe('RowBinary decoder', () => {
  describe('Unsigned integers', () => {
    it('should decode UInt16', async () => {
      const args: [Uint8Array, number][] = [
        [new Uint8Array([0x00, 0x00]), 0],
        [new Uint8Array([0x01, 0x00]), 1],
        [new Uint8Array([0x02, 0x00]), 2],
        [new Uint8Array([0x10, 0x00]), 16],
        [new Uint8Array([0xff, 0x00]), 255],
        [new Uint8Array([0xff, 0xff]), 65_535],
        [new Uint8Array([0x00, 0x80]), 32_768],
      ]
      args.forEach(([src, expected]) => {
        expect(readBytesAsInt(src, 0, 2, false))
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
        [new Uint8Array([0xff, 0xff, 0x00, 0x00]), 65_535],
        [new Uint8Array([0xff, 0xff, 0xff, 0x00]), 16_777_215],
        [new Uint8Array([0xff, 0xff, 0xff, 0x7f]), 2_147_483_647],
        [new Uint8Array([0xff, 0xff, 0xff, 0xff]), 4_294_967_295],
        [new Uint8Array([0x00, 0x00, 0x00, 0x80]), 2_147_483_648],
      ]
      args.forEach(([src, expected]) => {
        expect(readBytesAsInt(src, 0, 4, false))
          .withContext(ctx(src, expected))
          .toBe(expected)
      })
    })
  })

  describe('Signed integers', () => {
    it('should decode Int16', async () => {
      const args: [Uint8Array, number][] = [
        [new Uint8Array([0x00, 0x00]), 0],
        [new Uint8Array([0x01, 0x00]), 1],
        [new Uint8Array([0x02, 0x00]), 2],
        [new Uint8Array([0x10, 0x00]), 16],
        [new Uint8Array([0xff, 0x00]), 255],
        [new Uint8Array([0xff, 0xff]), -1],
        [new Uint8Array([0x00, 0x80]), -32_768],
      ]
      args.forEach(([src, expected]) => {
        expect(readBytesAsInt(src, 0, 2, true))
          .withContext(ctx(src, expected))
          .toBe(expected)
      })
    })
    it('should decode Int32', async () => {
      const args: [Uint8Array, number][] = [
        [new Uint8Array([0x00, 0x00, 0x00, 0x00]), 0],
        [new Uint8Array([0x01, 0x00, 0x00, 0x00]), 1],
        [new Uint8Array([0x02, 0x00, 0x00, 0x00]), 2],
        [new Uint8Array([0x10, 0x00, 0x00, 0x00]), 16],
        [new Uint8Array([0xff, 0x00, 0x00, 0x00]), 255],
        [new Uint8Array([0xff, 0xff, 0x00, 0x00]), 65_535],
        [new Uint8Array([0xff, 0xff, 0xff, 0x00]), 16_777_215],
        [new Uint8Array([0xff, 0xff, 0xff, 0x7f]), 2_147_483_647],
        [new Uint8Array([0xff, 0xff, 0xff, 0xff]), -1],
        [new Uint8Array([0x00, 0x00, 0x00, 0x80]), -2_147_483_648],
      ]
      args.forEach(([src, expected]) => {
        expect(readBytesAsInt(src, 0, 4, true))
          .withContext(ctx(src, expected))
          .toBe(expected)
      })
    })
  })

  describe('BigInt', () => {
    it('should decode UInt64', async () => {
      const args: [Uint8Array, BigInt][] = [
        [new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), 0n],
        [new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), 1n],
        [new Uint8Array([0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), 2n],
        [
          new Uint8Array([0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
          255n,
        ],
        [
          new Uint8Array([0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
          65_535n,
        ],
        [
          new Uint8Array([0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00]),
          16_777_215n,
        ],
        [
          new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00]),
          4_294_967_295n,
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

    it('should decode Int64 ', async () => {
      expect(
        readBytesAsSignedBigInt(
          new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80]),
          0,
          8
        )
      ).toEqual(1n)
    })
  })

  function ctx(src: Uint8Array, expected: number | BigInt) {
    return `Expected ${src.toString()} to be decoded as ${expected}`
  }
})
