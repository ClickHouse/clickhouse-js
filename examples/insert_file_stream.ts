import { createClient } from '@clickhouse/client'
import Path from 'path'
import Fs from 'fs'
void (async () => {
  const client = createClient()
  const tableName = 'insert_file_stream'
  await client.exec({
    query: `DROP TABLE IF EXISTS ${tableName}`,
  })
  await client.exec({
    query: `
      CREATE TABLE ${tableName} (id UInt64)
      ENGINE MergeTree()
      ORDER BY (id)
    `,
  })
  // contains id as numbers in JSONCompactEachRow format ["0"]\n["0"]\n...
  const filename = Path.resolve(process.cwd(), './resources/data.ndjson')

  await client.insert({
    table: tableName,
    values: Fs.createReadStream(filename),
  })

  const rows = await client.query({
    query: `SELECT * from ${tableName}`,
    format: 'JSON',
  })

  // or just `rows.text()` to consume the entire response at once
  for await (const row of rows.stream()) {
    console.log(row.text())
  }
})()
