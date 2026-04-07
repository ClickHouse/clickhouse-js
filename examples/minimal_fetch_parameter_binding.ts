/**
 * Minimal fetch client example: Query with parameter binding
 *
 * This example demonstrates query parameter binding.
 * Equivalent to: examples/query_with_parameter_binding.ts (simplified)
 */

import { createClient } from './minimal_fetch_client'

const client = createClient()

// Using query parameters for safe SQL injection prevention
const result = await client.query({
  query:
    'SELECT * FROM system.numbers WHERE number > {min:UInt64} LIMIT {limit:UInt32}',
  format: 'JSONEachRow',
  query_params: {
    min: 5,
    limit: 3,
  },
})

console.info('Query with parameters result:', result)
await client.close()
