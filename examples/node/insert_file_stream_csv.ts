import { createClient } from '@clickhouse/client'
import type { Row } from '@clickhouse/client-common'
import Fs from 'fs'
import { cwd } from 'node:process'
import Path from 'path'

void (async () => {
  const client = createClient()
  const tableName = 'insert_file_stream_csv'
  await client.command({
    query: `DROP TABLE IF EXISTS ${tableName}`,
  })
  await client.command({
    query: `
      CREATE TABLE ${tableName}
      (id UInt64, name String, flags Array(UInt8))
      ENGINE MergeTree()
      ORDER BY (id)
    `,
  })

  // contains data as 1,"foo","[1,2]"\n2,"bar","[3,4]"\n...
  const filename = Path.resolve(cwd(), './node/resources/data.csv')
  const fileStream = Fs.createReadStream(filename)

  await client.insert({
    table: tableName,
    values: fileStream,
    format: 'CSV',
  })

  const rs = await client.query({
    query: `SELECT * from ${tableName}`,
    format: 'CSV',
  })

  for await (const rows of rs.stream()) {
    // or just `rows.text()`
    // to consume the entire response at once
    rows.forEach((row: Row) => {
      console.log(row.text)
    })
  }

  await client.close()
})()
