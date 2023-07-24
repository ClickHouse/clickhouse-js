import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

/**
 * Taken from https://github.com/ClickHouse/clickhouse-js/issues/166
 */
void (async () => {
  const tableName = 'insert_from_select'
  const client = createClient()
  await client.command({
    query: `DROP TABLE IF EXISTS ${tableName}`,
  })
  await client.command({
    query: `
      CREATE TABLE ${tableName}
      (id String, data AggregateFunction(quantilesBFloat16(0.5), Float32))
      ENGINE MergeTree()
      ORDER BY (id)
    `,
  })
  await client.command({
    query: `
      INSERT INTO ${tableName}
      SELECT '42', quantilesBFloat16State(0.5)(arrayJoin([toFloat32(10), toFloat32(20)]))`,
  })
  const rows = await client.query({
    query: `SELECT finalizeAggregation(data) AS result FROM ${tableName}`,
    format: 'JSONEachRow',
  })
  console.info(await rows.json())
  await client.close()
})()
