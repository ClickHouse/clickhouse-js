import { createClient } from '@clickhouse/client-web'

// Using a `session_id` so that a `TEMPORARY TABLE` created on one request is visible on the next.
// Temporary tables only exist for the lifetime of the session and are scoped to the node that
// served the CREATE — see also `session_level_commands.ts` for caveats behind load balancers.
// Web variant: uses `globalThis.crypto.randomUUID()` instead of Node's `node:crypto`.
const tableName = 'temporary_example_web'
const client = createClient({
  session_id: globalThis.crypto.randomUUID(),
})
await client.command({
  query: `CREATE TEMPORARY TABLE ${tableName} (i Int32)`,
})
await client.insert({
  table: tableName,
  values: [{ i: 42 }, { i: 144 }],
  format: 'JSONEachRow',
})
const rs = await client.query({
  query: `SELECT * FROM ${tableName}`,
  format: 'JSONEachRow',
})
console.info(await rs.json())
await client.close()
