import { createClient } from '@clickhouse/client-web'

/**
 * Query rows in JSONEachRow format and map them to a typed result shape.
 *
 * See also:
 *  - `select_json_with_metadata.ts` for metadata-aware JSON responses.
 *  - `select_data_formats_overview.ts` for a broader format comparison.
 */
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
