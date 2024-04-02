import type { ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient, guid } from '@test/utils'
import type Stream from 'stream'

describe('[Node.js] stream RowBinary', () => {
  let client: ClickHouseClient<Stream.Readable>
  let tableName: string

  beforeEach(async () => {
    client = createTestClient()
  })
  afterEach(async () => {
    await client.close()
  })

  it('should stream booleans and integers up to 32 bits', async () => {
    const columns = [
      ['b', 'Bool'],
      ['i8', 'Int8'],
      ['i16', 'Int16'],
      ['i32', 'Int32'],
      ['u8', 'UInt8'],
      ['u16', 'UInt16'],
      ['u32', 'UInt32'],
    ]
    const values = [
      [true, 127, 32767, 2147483647, 255, 65535, 4294967295],
      [false, -128, -32768, -2147483648, 120, 1234, 51234],
    ]
    await createTableWithData(columns, values, 'int')
    await selectAndAssert(values)
  })

  it('should stream 64/128/256-bit integers', async () => {
    const columns = [
      ['i64', 'Int64'],
      ['i128', 'Int128'],
      ['i256', 'Int256'],
      // ['u64', 'UInt64'],
      // ['u128', 'UInt128'],
      // ['u256', 'UInt256'],
    ]
    const insertValues = [
      [
        '9223372036854775807',
        '170141183460469231731687303715884105727',
        '57896044618658097711785492504343953926634992332820282019728792003956564819967',
        // '18446744073709551615',
        // '340282366920938463463374607431768211455',
        // '115792089237316195423570985008687907853269984665640564039457584007913129639935',
      ],
      [
        '-9223372036854775808',
        '-170141183460469231731687303715884105728',
        '-57896044618658097711785492504343953926634992332820282019728792003956564819968',
        // '120',
        // '1234',
        // '51234',
      ],
    ]
    const assertValues = [
      [
        BigInt('9223372036854775807'),
        BigInt('170141183460469231731687303715884105727'),
        BigInt(
          '57896044618658097711785492504343953926634992332820282019728792003956564819967',
        ),
        // BigInt('18446744073709551615'),
        // BigInt('340282366920938463463374607431768211455'),
        // BigInt(
        //   '115792089237316195423570985008687907853269984665640564039457584007913129639935'
        // ),
      ],
      [
        BigInt('-9223372036854775808'),
        BigInt('-170141183460469231731687303715884105728'),
        BigInt(
          '-57896044618658097711785492504343953926634992332820282019728792003956564819968',
        ),
        // BigInt('120'),
        // BigInt('1234'),
        // BigInt('51234'),
      ],
    ]
    await createTableWithData(columns, insertValues, 'bigint')
    await selectAndAssert(assertValues)
  })

  async function selectAndAssert(assertValues: unknown[][]) {
    const rs = await client.query({
      query: `SELECT * EXCEPT id FROM ${tableName} ORDER BY id ASC`,
      format: 'RowBinary',
    })
    const values: unknown[][] = []
    for await (const rows of rs.stream()) {
      rows.forEach((row: unknown[]) => {
        values.push(row)
      })
    }
    expect(values).toEqual(assertValues)
  }

  async function createTableWithData(
    colNameToType: string[][],
    insertValues: unknown[][],
    testName: string,
  ) {
    tableName = `insert_stream_row_binary_${testName}_${guid()}`
    const cols = colNameToType
      .map(([name, type]) => `${name} ${type}`)
      .join(', ')
    await client.command({
      query: `CREATE TABLE ${tableName} (id UInt32, ${cols}) ENGINE MergeTree ORDER BY (id)`,
      clickhouse_settings: {
        wait_end_of_query: 1,
      },
    })
    let id = 1
    await client.insert({
      table: tableName,
      values: insertValues.map((value) => [id++, ...value]),
      format: 'JSONCompactEachRow',
    })
  }
})
