import type { Row } from '@clickhouse/client'
import { createClient } from '@clickhouse/client'
import Fs from 'fs'
import { cwd } from 'node:process'
import Path from 'path'
import split from 'split2'

void (async () => {
  const client = createClient()
  const tableName = 'insert_file_stream_ndjson'
  await client.command({
    query: `DROP TABLE IF EXISTS ${tableName}`,
  })
  await client.command({
    query: `
      CREATE TABLE ${tableName} (id UInt64)
      ENGINE MergeTree()
      ORDER BY (id)
    `,
  })

  // contains id as numbers in JSONCompactEachRow format ["0"]\n["0"]\n...
  // see also: NDJSON format
  const filename = Path.resolve(cwd(), './node/resources/data.ndjson')
  const fileStream = Fs.createReadStream(filename).pipe(
    split((row: string) => JSON.parse(row))
  )

  await client.insert({
    table: tableName,
    values: fileStream,
    format: 'JSONCompactEachRow',
  })

  const rs = await client.query({
    query: `SELECT * from ${tableName}`,
    format: 'JSONEachRow',
  })

  for await (const rows of rs.stream()) {
    // or just `rows.text()` / `rows.json()`
    // to consume the entire response at once
    rows.forEach((row: Row) => {
      console.log(row.json())
    })
  }

  await client.close()
})()
