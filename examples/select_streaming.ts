import { createClient } from '@clickhouse/client'

// RECOMMENDED way of consuming larger datasets
// to reduce the memory footprint of your application
// if it suits your use case
void (async () => {
  const client = createClient()
  const rows = await client.query({
    query: 'SELECT number FROM system.numbers LIMIT 10',
    format: 'JSONEachRow',
  })
  for await (const row of rows.stream()) {
    console.log(row.json())
  }
  await client.close()
})()
