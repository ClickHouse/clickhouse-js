import { createClient } from '@clickhouse/client' // or @clickhouse/client-web

void (async () => {
  const client = createClient()
  const tableName = 'insert_decimals_example'
  await client.command({
    query: `
      CREATE OR REPLACE TABLE ${tableName}
      (
        id     UInt32,
        dec32  Decimal(9, 2),
        dec64  Decimal(18, 3),
        dec128 Decimal(38, 10),
        dec256 Decimal(76, 20)
      )
      ENGINE MergeTree()
      ORDER BY (id)
    `,
  })
  const row1 = {
    id: 1,
    dec32: '1234567.89',
    dec64: '123456789123456.789',
    dec128: '1234567891234567891234567891.1234567891',
    dec256:
      '12345678912345678912345678911234567891234567891234567891.12345678911234567891',
  }
  const row2 = {
    id: 2,
    dec32: '12.01',
    dec64: '5000000.405',
    dec128: '1.0000000004',
    dec256: '42.00000000000000013007',
  }
  await client.insert({
    table: tableName,
    values: [row1, row2],
    format: 'JSONEachRow',
  })
  const resultSet = await client.query({
    query: `
      SELECT toString(dec32)  AS decimal32,
             toString(dec64)  AS decimal64,
             toString(dec128) AS decimal128,
             toString(dec256) AS decimal256
      FROM ${tableName}
    `,
    format: 'JSONEachRow',
  })
  console.log('Result:', await resultSet.json())
  await client.close()
})()
