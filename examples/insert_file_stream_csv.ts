import { createClient } from '@clickhouse/client'
import Path from 'path'
import Fs from 'fs'

void (async () => {
  const client = createClient()
  const tableName = 'insert_file_stream_csv'
  await client.exec({
    query: `DROP TABLE IF EXISTS ${tableName}`,
  })
  await client.exec({
    query: `
      CREATE TABLE ${tableName}
      (id UInt64, name String, flags Array(UInt8))
      ENGINE MergeTree()
      ORDER BY (id)
    `,
  })

  // contains data as 1,"foo","[1,2]"\n2,"bar","[3,4]"\n...
  const filename = Path.resolve(process.cwd(), './examples/resources/data.csv')

  await client.insert({
    table: tableName,
    values: Fs.createReadStream(filename),
    format: 'CSV',
  })

  const rows = await client.query({
    query: `SELECT * from ${tableName}`,
    format: 'CSV',
  })

  // or just `rows.text()` to consume the entire response at once
  // NB: `json()` calls are not supported for "raw" formats such as CSV
  for await (const row of rows.stream()) {
    console.log(row.text())
  }

  await client.close()
})()
