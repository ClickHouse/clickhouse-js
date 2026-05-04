import { createClient } from '@clickhouse/client-web'

// Selecting rows in `JSONEachRow` format and parsing them into a typed array via `rows.json<T>()`.
// This is the simplest path for "give me all rows as JS objects". For larger result sets,
// stream instead — see node/select_streaming_json_each_row.ts (Node-only).
interface Data {
  number: string
}

const client = createClient()
const rows = await client.query({
  query: 'SELECT number FROM system.numbers LIMIT 5',
  format: 'JSONEachRow',
})
const result = await rows.json<Data>()
result.forEach((row) => console.log(row))
await client.close()
