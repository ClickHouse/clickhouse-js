import { createClient } from '@clickhouse/client'
import * as crypto from 'node:crypto'

const tableName = 'temporary_example'
const client = createClient({
  session_id: crypto.randomUUID(),
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
