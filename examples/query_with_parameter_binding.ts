import { createClient } from '@clickhouse/client'
void (async () => {
  const client = createClient()
  const rows = await client.query({
    query: 'SELECT plus({val1: Int32}, {val2: Int32})',
    format: 'CSV',
    query_params: {
      val1: 10,
      val2: 20,
    },
  })
  const result = await rows.text()
  console.info(result)
  await client.close()
})()
