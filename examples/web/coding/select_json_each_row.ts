// Query rows in JSONEachRow format and map them to a typed result shape via `rows.json<T>()`.
// This is the simplest path for "give me all rows as JS objects" (Web variant). The Web client's
// ResultSet also supports streaming via `.stream()` (returns a `ReadableStream<Row[]>`); there is
// no dedicated Web streaming example file yet — see `node/performance/select_streaming_json_each_row.ts`
// for the Node-side streaming pattern.
//
// See also:
//  - `select_json_with_metadata.ts` for metadata-aware JSON responses.
//  - `select_data_formats_overview.ts` for a broader format comparison.
import { createClient } from '@clickhouse/client-web'

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
