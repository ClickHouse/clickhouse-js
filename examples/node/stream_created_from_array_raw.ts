import { createClient } from '@clickhouse/client'
import Stream from 'stream'

// If your application deals with a string input that can be considered as one of "raw" formats, such as CSV, TabSeparated, etc.
// the client will require the input values to be converted into a Stream.Readable instance.
// If your input is already a stream, then no conversion is needed; see insert_file_stream_csv.ts for an example.
// See all supported formats for streaming:
// https://clickhouse.com/docs/en/integrations/language-clients/javascript#supported-data-formats
void (async () => {
  const tableName = 'insert_stream_created_from_array_raw'
  const client = createClient()
  await client.command({
    query: `DROP TABLE IF EXISTS ${tableName}`,
  })
  await client.command({
    query: `
      CREATE TABLE ${tableName}
      (id UInt64, name String)
      ENGINE MergeTree()
      ORDER BY (id)
    `,
  })
  await client.insert({
    table: tableName,
    // structure should match the desired format, CSV in this example
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
