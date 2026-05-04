import { createClient, type ResponseJSON } from '@clickhouse/client-web'

// Selecting rows in the `JSON` format, which wraps the data in an envelope containing
// `meta`, `data`, `rows`, `statistics`, etc. Type the result as `ResponseJSON<Row>`.
// Use this when you need column metadata or row counts alongside the data.
const client = createClient()
const rows = await client.query({
  query: 'SELECT number FROM system.numbers LIMIT 2',
  format: 'JSON',
})
const result = await rows.json<ResponseJSON<{ number: string }>>()
console.info(result)
await client.close()
