import { createClient } from '@clickhouse/client'
import Stream from 'stream'

void (async () => {
  const client = createClient()
  const tableName = 'insert_json_stream'
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

  const stream = new Stream.Readable({
    objectMode: true,
    read() {
      /* stub */
    },
  })

  stream.push([{ id: '42' }])
  setTimeout(function closeStream() {
    stream.push(null)
  }, 100)

  await client.insert({
    table: tableName,
    values: stream,
    format: 'JSONEachRow',
  })

  const rows = await client.query({
    query: `SELECT * from ${tableName}`,
    format: 'JSONEachRow',
  })

  console.log(await rows.json())

  await client.close()
})()
