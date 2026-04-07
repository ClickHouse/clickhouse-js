/**
 * Minimal fetch client example: Basic query
 *
 * This example demonstrates a simple SELECT query using the minimal fetch-based client.
 * Equivalent to: examples/select_json_each_row.ts
 */

import { createClient } from './minimal_fetch_client'

interface Data {
  number: string
}

const client = createClient()
const result = await client.query<Data>({
  query: 'SELECT number FROM system.numbers LIMIT 5',
  format: 'JSONEachRow',
})
result.forEach((row) => console.log(row))
await client.close()
