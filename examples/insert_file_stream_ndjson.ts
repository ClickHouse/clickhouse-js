import { createClient } from '@clickhouse/client'
import Path from 'path'
import fs from 'fs'
import { Transform } from 'stream'

void (async () => {
  const client = createClient()
  const tableName = 'insert_file_stream_ndjson'
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
  // see also: NDJSON format
  const filename = Path.resolve(
    process.cwd(),
    './examples/resources/data.ndjson'
  )
  const readStream = fs.createReadStream(filename)
  const jsonTransform = new Transform({
    transform(data: Buffer, encoding, callback) {
      data
        .toString(encoding)
        .split('\n')
        .forEach((line) => {
          if (!line.length) {
            return
          } else {
            const json = JSON.parse(line)
            this.push(json)
          }
        })
      callback()
    },
    objectMode: true,
  })
  await client.insert({
    table: tableName,
    values: readStream.pipe(jsonTransform),
    format: 'JSONCompactEachRow',
  })

  const rows = await client.query({
    query: `SELECT * from ${tableName}`,
    format: 'JSONEachRow',
  })

  // or just `rows.text()` / `rows.json()`
  // to consume the entire response at once
  for await (const row of rows.stream()) {
    console.log(row.json())
  }

  await client.close()
})()
