import {
  ClickHouseLogLevel,
  DefaultLogger,
  LogWriter,
  type ClickHouseClient,
} from '@clickhouse/client-common'
import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import { createSimpleTable } from '@test/fixtures/simple_table'
import { createTestClient } from '@test/utils/client'
import { guid } from '@test/utils/guid'
import Stream from 'stream'
import { drainStreamInternal } from '../../src/connection/stream'

describe('[Node.js] stream RowBinary insert', () => {
  let client: ClickHouseClient<Stream.Readable>
  let tableName: string
  let log_writer: LogWriter

  beforeEach(async () => {
    client = createTestClient()
    log_writer = new LogWriter(
      new DefaultLogger(),
      'Connection',
      ClickHouseLogLevel.OFF,
    )
    tableName = `test_node_row_binary_stream_${guid()}`
    await createSimpleTable(client, tableName)
  })
  afterEach(async () => {
    await client.close()
  })

  it('should send a RowBinary payload via a stream passed into the request body', async () => {
    // Schema: id UInt64, name String, sku Array(UInt8)
    // RowBinary encoding:
    //   UInt64 -> 8 bytes little-endian
    //   String -> varint length prefix + UTF-8 bytes
    //   Array(T) -> varint length prefix + items
    const row1 = Buffer.concat([
      uint64LE(42n),
      varString('foo'),
      varUInt8Array([1, 2]),
    ])
    const row2 = Buffer.concat([
      uint64LE(43n),
      varString('bar'),
      varUInt8Array([3, 4]),
    ])

    // Provide the payload via a Readable stream split across multiple chunks
    // to exercise the streaming code path on the request body.
    const stream = Stream.Readable.from([row1, row2], { objectMode: false })

    const execResult = await client.exec({
      query: `INSERT INTO ${tableName} FORMAT RowBinary`,
      values: stream,
    })
    // The result stream contains nothing useful for an insert and should be
    // immediately drained to release the socket.
    await drainStreamInternal(
      {
        op: 'Insert',
        query_id: execResult.query_id,
        log_writer,
        log_level: ClickHouseLogLevel.OFF,
      },
      execResult.stream,
    )

    const rs = await client.query({
      query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
      format: 'JSONEachRow',
    })
    expect(await rs.json()).toEqual([
      { id: '42', name: 'foo', sku: [1, 2] },
      { id: '43', name: 'bar', sku: [3, 4] },
    ])
  })
})

function uint64LE(value: bigint): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(value)
  return buf
}

// LEB128 unsigned varint, used by ClickHouse for length prefixes in RowBinary.
function varUInt(value: number): Buffer {
  const bytes: number[] = []
  let v = value
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80)
    v >>>= 7
  }
  bytes.push(v & 0x7f)
  return Buffer.from(bytes)
}

function varString(value: string): Buffer {
  const data = Buffer.from(value, 'utf8')
  return Buffer.concat([varUInt(data.length), data])
}

function varUInt8Array(values: number[]): Buffer {
  return Buffer.concat([varUInt(values.length), Buffer.from(values)])
}
