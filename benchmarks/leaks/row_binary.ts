import type { Row } from '@clickhouse/client'
import { createClient } from '@clickhouse/client'
import type { RowBinaryResultSet } from '@clickhouse/client/row_binary_result_set'
import { attachExceptionHandlers } from './shared'

/*

CREATE TABLE default.fluff
(
    `id` UInt32,
    `s1` String,
    `s2` String,
    `u8` UInt8,
    `i8` Int8,
    `u16` UInt16,
    `i16` Int16,
    `u32` UInt32,
    `i32` Int32,
    `u64` UInt64,
    `i64` Int64,
    `u128` UInt128,
    `i128` Int128,
    `u256` UInt256,
    `i256` Int256,
    `date` Date
)
ENGINE = MergeTree
ORDER BY id

INSERT INTO fluff SELECT *
FROM generateRandom('id UInt32, s1 String, s2 String, u8 UInt8, i8 Int8, u16 UInt16, i16 Int16, u32 UInt32, i32 Int32, u64 UInt64, i64 Int64, u128 UInt128, i128 Int128, u256 UInt256, i256 Int256, date Date')
LIMIT 5000000

 */

const query = `SELECT * FROM fluff ORDER BY id ASC LIMIT 1000000`

void (async () => {
  const client = createClient({
    url: 'http://localhost:8123',
  })

  async function benchmarkJSONEachRow() {
    const start = +new Date()
    const rs = await client.query({
      query,
      format: 'JSONCompactEachRow',
    })
    const values = []
    await new Promise((resolve, reject) => {
      rs.stream()
        .on('data', (rows: Row[]) => {
          rows.forEach((row) => {
            values.push(row.json())
          })
        })
        .on('end', resolve)
        .on('error', reject)
    })
    console.log(
      `JSONCompactEachRow elapsed: ${+new Date() - start} ms, total: ${
        values.length
      }`
    )
    return values.length
  }

  async function benchmarkRowBinary() {
    const start = +new Date()
    const rs = await client.query({
      query,
      format: 'RowBinary',
    })
    const values: unknown[][] = []
    await new Promise((resolve, reject) => {
      ;(rs as RowBinaryResultSet)
        .stream()
        .on('data', (rows: unknown[][]) => {
          rows.forEach((row) => {
            values.push(row)
          })
        })
        .on('end', resolve)
        .on('error', reject)
    })
    console.log(
      `RowBinary elapsed: ${+new Date() - start} ms, total: ${values.length}`
    )
    return values.length
  }

  attachExceptionHandlers()
  for (let i = 0; i < 10; i++) {
    await benchmarkJSONEachRow()
    await benchmarkRowBinary()
  }

  process.exit(0)
})()
