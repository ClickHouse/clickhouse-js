import { createClient } from '@clickhouse/client-web'

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
