/**
 * Minimal fetch client example: ClickHouse settings
 *
 * This example demonstrates passing ClickHouse settings.
 * Equivalent to: examples/clickhouse_settings.ts (simplified)
 */

import { createClient } from './minimal_fetch_client'

const client = createClient()

// Query with ClickHouse settings
const result = await client.query({
  query: 'SELECT version()',
  format: 'JSONEachRow',
  clickhouse_settings: {
    max_execution_time: 60,
    readonly: 1,
  },
})

console.info('ClickHouse version:', result)
await client.close()
