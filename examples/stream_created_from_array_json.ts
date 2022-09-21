import { createClient } from '@clickhouse/client'
import Stream from 'stream'
void (async () => {
  const client = createClient()
  const tableName = 'insert_stream_created_from_array_json'
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
    // structure should match the desired format, JSONCompactEachRow in this example
    values: Stream.Readable.from(
      [
        [42, 'foo'],
        [42, 'bar'],
      ],
      {
        objectMode: true, // required for JSON* formats
      }
    ),
    format: 'JSONCompactEachRow',
  })
  const rows = await client.query({
    query: `SELECT * FROM ${tableName}`,
    format: 'JSONEachRow',
  })
  // `.text()` call is also possible
  console.info(await rows.json())
  await client.close()
})()
