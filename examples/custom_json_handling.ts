import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

// Similar to `examples/insert_js_dates.ts`, we will attempt to insert a few weird data types into ClickHouse (namely bigint and dates)
void (async () => {
  const valueSerializer = (value: unknown): unknown => {
    if (value instanceof Date) {
      return value.getTime()
    }

    if (typeof value === 'bigint') {
      return value.toString()
    }

    if (Array.isArray(value)) {
      return value.map(valueSerializer)
    }

    return value
  }

  const tableName = 'inserts_custom_json_handling'
  const client = createClient({
    json: {
      parse: JSON.parse,
      stringify: (obj: unknown) => JSON.stringify(valueSerializer(obj)),
    },
  })
  await client.command({
    query: `DROP TABLE IF EXISTS ${tableName}`,
  })
  await client.command({
    query: `
      CREATE TABLE ${tableName}
      (id UInt64, dt DateTime64(3, 'UTC'))
      ENGINE MergeTree()
      ORDER BY (id)
    `,
  })
  await client.insert({
    table: tableName,
    values: [
      {
        id: BigInt(250000000000000200),
        dt: new Date(),
      },
    ],
    format: 'JSONEachRow',
  })
  const rows = await client.query({
    query: `SELECT * FROM ${tableName}`,
    format: 'JSONEachRow',
  })
  console.info(await rows.json())
  await client.close()
})()
