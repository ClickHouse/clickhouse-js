import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

interface Data {
  number: string
}

void (async () => {
  const client = createClient()
  const rows = await client.query({
    query: 'SELECT number FROM system.numbers LIMIT 5',
    format: 'JSONEachRow',
  })
  const result = await rows.json<Data>()
  result.map((row) => console.log(row))
  await client.close()
})()
