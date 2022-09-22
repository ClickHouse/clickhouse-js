import { createClient } from '@clickhouse/client'
void (async () => {
  const client = createClient()
  const rows = await client.query({
    query: 'SELECT number FROM system.numbers LIMIT 2',
    format: 'JSONEachRow',
    clickhouse_settings: {
      // See ClickHouseSettings typings
      connect_timeout: 30,
    },
  })
  console.info(await rows.json())
  await client.close()
})()
