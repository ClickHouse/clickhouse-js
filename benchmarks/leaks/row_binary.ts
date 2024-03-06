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

const limit = 50000
const query = `SELECT * FROM fluff ORDER BY id ASC LIMIT 5`
// const query = `SELECT * FROM large_strings ORDER BY id ASC LIMIT ${limit}`
// const query = `SELECT * EXCEPT (i128, i256, u128, u256) FROM fluff ORDER BY id ASC LIMIT ${limit}`

void (async () => {
  const client = createClient({
    url: 'http://localhost:8123',
  })

  async function benchmarkJSON(format: 'JSONEachRow' | 'JSONCompactEachRow') {
    const start = +new Date()
    const rs = await client.query({
      query,
      format,
    })
    let total = 0
    await new Promise((resolve, reject) => {
      rs.stream()
        .on('data', (rows: Row[]) => {
          rows.forEach((row) => {
            console.log(row.json())
            total++
          })
        })
        .on('end', resolve)
        .on('error', reject)
    })
    console.log(`${format} elapsed: ${+new Date() - start} ms, total: ${total}`)
    return total
  }

  async function benchmarkCSV() {
    const start = +new Date()
    const rs = await client.query({
      query,
      format: 'CSV',
    })
    let total = 0
    await new Promise((resolve, reject) => {
      rs.stream()
        .on('data', (rows: Row[]) => {
          rows.forEach((row) => {
            row.text.split(',')
            total++
          })
        })
        .on('end', resolve)
        .on('error', reject)
    })
    console.log(`CSV elapsed: ${+new Date() - start} ms, total: ${total}`)
    return total
  }

  async function benchmarkRowBinary() {
    const start = +new Date()
    const rs = await client.query({
      query,
      format: 'RowBinary',
    })
    let total = 0
    await new Promise((resolve, reject) => {
      ;(rs as RowBinaryResultSet)
        .stream()
        .on('data', (rows: unknown[][]) => {
          rows.forEach((row) => {
            total++
            // if (total === limit) {
            console.log(`Last row`, row)
            // }
          })
        })
        .on('end', resolve)
        .on('error', reject)
    })
    console.log(`RowBinary elapsed: ${+new Date() - start} ms, total: ${total}`)
    return total
  }

  attachExceptionHandlers()
  for (let i = 0; i < 3; i++) {
    await benchmarkJSON('JSONCompactEachRow')
    // await benchmarkCSV()
    await benchmarkRowBinary()
  }
  process.exit(0)
})()
