import { createClient } from '@clickhouse/client'
import Stream from 'stream'

void (async () => {
  const tableName = 'insert_stream_created_from_array_raw'
  const client = createClient()
  await client.exec({
    query: `DROP TABLE IF EXISTS ${tableName}`,
  })
  await client.exec({
    query: `
      CREATE TABLE ${tableName}
      (id UInt64, name String)
      ENGINE MergeTree()
      ORDER BY (id)
    `,
  })
  await client.insert({
    table: tableName,
    // structure should match the desired format, TabSeparated in this example
    values: Stream.Readable.from(['42,foo\n43,bar'], {
      objectMode: false, // required for "raw" family formats
    }),
    format: 'CSV', // or any other desired "raw" format
  })
  const rows = await client.query({
    query: `SELECT * FROM ${tableName}`,
    format: 'CSV',
  })
  // Note that `.json()` call is not possible here due to "raw" format usage
  console.info(await rows.text())
  await client.close()
})()
