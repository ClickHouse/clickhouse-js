import { RowBinaryTypesDecoder } from '../../src/data_formatter'

describe('RowBinary decoders', () => {
  it('should decode Date', () => {
    const args: [Uint8Array, Date][] = [
      [new Uint8Array([0x00, 0x00]), new Date('1970-01-01T00:00:00.000Z')],
      [new Uint8Array([0x01, 0x00]), new Date('1970-01-02T00:00:00.000Z')],
      [new Uint8Array([0x02, 0x00]), new Date('1970-01-03T00:00:00.000Z')],
      [new Uint8Array([0x10, 0x00]), new Date('1970-01-17T00:00:00.000Z')],
      [new Uint8Array([0x4a, 0x4d]), new Date('2024-03-04T00:00:00.000Z')],
      [new Uint8Array([0xff, 0xff]), new Date('2149-06-06T00:00:00.000Z')],
    ]
    args.forEach(([src, expected]) => {
      const res = RowBinaryTypesDecoder.date(Buffer.from(src), 0)!
      expect(+res[0])
        .withContext(
          `Decoded ${src.toString()}. Result ${res[0]} != expected ${expected}`
        )
        .toEqual(+expected)
    })
  })
})
