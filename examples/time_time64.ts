import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

/** See also:
 *  - https://clickhouse.com/docs/sql-reference/data-types/time
 *  - https://clickhouse.com/docs/sql-reference/data-types/time64 */
void (async () => {
  const tableName = `chjs_time_time64`
  const client = createClient({
    clickhouse_settings: {
      // Since ClickHouse 25.6
      enable_time_time64_type: 1,
    },
  })
  await client.command({
    query: `
      CREATE OR REPLACE TABLE ${tableName}
      (
        id    UInt64,
        t     Time,
        t64_0 Time64(0),
        t64_3 Time64(3),
        t64_6 Time64(6),
        t64_9 Time64(9),
      )
      ENGINE MergeTree
      ORDER BY id
    `,
  })
  // Sample representation in JSONEachRow format
  const values = [
    {
      id: 1,
      t: '12:34:56',
      t64_0: '12:34:56',
      t64_3: '12:34:56.123',
      t64_6: '12:34:56.123456',
      t64_9: '12:34:56.123456789',
    },
    {
      id: 2,
      t: '23:59:59',
      t64_0: '23:59:59',
      t64_3: '23:59:59.987',
      t64_6: '23:59:59.987654',
      t64_9: '23:59:59.987654321',
    },
    {
      id: 3,
      t: '999:59:59',
      t64_0: '999:59:59',
      t64_3: '999:59:59.999',
      t64_6: '999:59:59.999999',
      t64_9: '999:59:59.999999999',
    },
    {
      id: 4,
      t: '-999:59:59',
      t64_0: '-999:59:59',
      t64_3: '-999:59:59.999',
      t64_6: '-999:59:59.999999',
      t64_9: '-999:59:59.999999999',
    },
  ]
  await client.insert({
    table: tableName,
    format: 'JSONEachRow',
    values,
  })
  const rs = await client.query({
    query: `SELECT * FROM ${tableName}`,
    format: 'JSONEachRow',
  })
  console.log(await rs.json())
  await client.close()
})()
