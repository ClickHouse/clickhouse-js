import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

type Data = { number: string }

void (async () => {
  const client = createClient()
  const rows = await client.query({
    query: 'SELECT number FROM system.numbers LIMIT 5',
    format: 'JSONEachRow',
  })
  const result = await rows.json<Array<Data>>()
  result.map((row: Data) => console.log(row))
  await client.close()
})()
