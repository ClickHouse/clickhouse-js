// Query rows in JSON format with response metadata. The `JSON` envelope wraps results in
// `meta`, `data`, `rows`, `statistics`, etc. — type the response as `ResponseJSON<Row>`
// when you need column metadata or row counts alongside the data.
//
// See also:
//  - `select_json_each_row.ts` for row-by-row JSON output.
//  - `select_data_formats_overview.ts` for a broader format comparison.
import { createClient, type ResponseJSON } from '@clickhouse/client'

const client = createClient()
const rows = await client.query({
  query: 'SELECT number FROM system.numbers LIMIT 2',
  format: 'JSON',
})
const result = await rows.json<ResponseJSON<{ number: string }>>()
console.log(result)
await client.close()
