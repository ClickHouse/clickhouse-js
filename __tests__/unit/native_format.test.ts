// added as an example. based on
// https://clickhouse.com/docs/en/native-protocol/basics
describe('encoding', () => {
  describe('string', () => {
    const input = 'Hello, world!'

    const inputBinary = Buffer.from([
      0x00, 0x00, 0x00, 0x00, 0x00, 0x0d, 0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x2c,
      0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64, 0x21,
    ])

    it('encode', () => {
      const counterBuffer = Buffer.alloc(6)
      // max length of string is 2^53 - 1, we allocate 6 bytes manually
      counterBuffer.writeUintBE(input.length, 0, 6)

      const contentBuffer = Buffer.from(input, 'utf8')
      const finalBuffer = Buffer.concat([counterBuffer, contentBuffer])

      expect(Buffer.compare(finalBuffer, inputBinary)).toBe(0)
    })

    it('decode', () => {
      const length = inputBinary.readUintBE(0, 6)
      const output = inputBinary.toString('utf8', 6)
      expect(output.length).toBe(length)
      expect(output).toBe(input)
    })
  })

  describe('number', () => {
    const input = 1000

    const inputBinary = Buffer.from([0xe8, 0x03, 0x00, 0x00])

    it('encode', () => {
      const buffer = Buffer.alloc(4)
      //ClickHouse uses Little Endian for fixed size integers.
      buffer.writeUint32LE(input)

      expect(Buffer.compare(buffer, inputBinary)).toBe(0)
    })

    it('decode', () => {
      expect(inputBinary.readUint32LE(0)).toBe(input)
    })
  })
})
