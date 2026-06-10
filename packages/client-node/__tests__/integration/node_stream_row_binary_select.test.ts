import type { ClickHouseClient } from '@clickhouse/client-common'
import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import { createSimpleTable } from '@test/fixtures/simple_table'
import { createTestClient } from '@test/utils/client'
import { guid } from '@test/utils/guid'
import type Stream from 'stream'

describe('[Node.js] stream RowBinary select', () => {
  let client: ClickHouseClient<Stream.Readable>
  let tableName: string

  beforeEach(async () => {
    client = createTestClient()
    tableName = `test_node_row_binary_select_stream_${guid()}`
    await createSimpleTable(client, tableName)
    await client.insert({
      table: tableName,
      values: [
        { id: '42', name: 'foo', sku: [1, 2] },
        { id: '43', name: 'bar', sku: [3, 4] },
      ],
      format: 'JSONEachRow',
    })
  })
  afterEach(async () => {
    await client.close()
  })

  it('should read a RowBinary payload from the response stream', async () => {
    // Schema: id UInt64, name String, sku Array(UInt8)
    const { stream } = await client.exec({
      query: `SELECT * FROM ${tableName} ORDER BY id ASC FORMAT RowBinary`,
    })

    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const payload = Buffer.concat(chunks)

    // RowBinary decoding:
    //   UInt64 -> 8 bytes little-endian
    //   String -> varint length prefix + UTF-8 bytes
    //   Array(T) -> varint length prefix + items
    const reader = new BufferReader(payload)
    const rows: Array<{ id: string; name: string; sku: number[] }> = []
    while (!reader.eof()) {
      const id = reader.readUInt64LE().toString()
      const name = reader.readString()
      const sku = reader.readUInt8Array()
      rows.push({ id, name, sku })
    }
    expect(reader.eof()).toBe(true)
    expect(rows).toEqual([
      { id: '42', name: 'foo', sku: [1, 2] },
      { id: '43', name: 'bar', sku: [3, 4] },
    ])
  })
})

class BufferReader {
  private offset = 0
  private readonly buf: Buffer
  constructor(buf: Buffer) {
    this.buf = buf
  }

  eof(): boolean {
    return this.offset >= this.buf.length
  }

  readUInt64LE(): bigint {
    const value = this.buf.readBigUInt64LE(this.offset)
    this.offset += 8
    return value
  }

  // LEB128 unsigned varint, used by ClickHouse for length prefixes in RowBinary.
  readVarUInt(): number {
    let value = 0
    let shift = 0
    while (true) {
      const byte = this.buf[this.offset++]
      value |= (byte & 0x7f) << shift
      if ((byte & 0x80) === 0) {
        return value >>> 0
      }
      shift += 7
    }
  }

  readString(): string {
    const length = this.readVarUInt()
    const value = this.buf.toString('utf8', this.offset, this.offset + length)
    this.offset += length
    return value
  }

  readUInt8Array(): number[] {
    const length = this.readVarUInt()
    const slice = this.buf.subarray(this.offset, this.offset + length)
    this.offset += length
    return Array.from(slice)
  }
}
