import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

void (async () => {
  const client = createClient({
    host: getFromEnv('CLICKHOUSE_HOST'),
    password: getFromEnv('CLICKHOUSE_PASSWORD'),
    // See https://clickhouse.com/docs/en/optimize/asynchronous-inserts
    clickhouse_settings: {
      async_insert: 1,
      wait_for_async_insert: 1,
    },
  })

  // Create the table if necessary
  const table = 'async_insert_example'
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${table}
      (id UInt32, data String)
      ENGINE MergeTree
      ORDER BY id
    `,
    // Tell the server to send the response only when the DDL is fully executed
    clickhouse_settings: {
      wait_end_of_query: 1,
    },
  })

  // Generate some random data for the sake of example...
  const batch = [...new Array(1_000).keys()].map(() => ({
    id: Math.floor(Math.random() * 100_000) + 1,
    data: Math.random().toString(36).slice(2),
  }))

  await client.insert({
    table,
    format: 'JSONEachRow', // or other, depends on your data
    values: batch,
  })

  const res = await client
    .query({
      query: `SELECT count(*) FROM ${table}`,
      format: 'JSONEachRow',
    })
    .then((r) => r.json())

  console.info(res)
})()

// Node.js only
function getFromEnv(key: string) {
  if (process.env[key]) {
    return process.env[key]
  }
  console.error(`${key} environment variable should be set`)
  process.exit(1)
}
