import { createClient, type Row } from '@clickhouse/client'

/**
 * Can be used for consuming large datasets for reducing memory overhead,
 * or if your response exceeds built in Node.js limitations, such as 512Mb for strings.
 *
 * Each of the response chunks will be transformed into a relatively small arrays of rows instead
 * (the size of this array depends on the size of a particular chunk the client receives from the server,
 * as it may vary, and the size of an individual row), one chunk at a time.
 *
 * The following JSON formats can be streamed (note "EachRow" in the format name, with JSONObjectEachRow as an exception to the rule):
 *  - JSONEachRow
 *  - JSONStringsEachRow
 *  - JSONCompactEachRow
 *  - JSONCompactStringsEachRow
 *  - JSONCompactEachRowWithNames
 *  - JSONCompactEachRowWithNamesAndTypes
 *  - JSONCompactStringsEachRowWithNames
 *  - JSONCompactStringsEachRowWithNamesAndTypes
 *
 * See other supported formats for streaming:
 * https://clickhouse.com/docs/en/integrations/language-clients/javascript#supported-data-formats
 *
 * NB: There might be confusion between JSON as a general format and ClickHouse JSON format (https://clickhouse.com/docs/en/sql-reference/formats#json).
 * The client supports streaming JSON objects with JSONEachRow and other JSON*EachRow formats (see the list above);
 * it's just that ClickHouse JSON format and a few others are represented as a single object in the response and cannot be streamed by the client.
 */
void (async () => {
  const client = createClient()
  const rows = await client.query({
    query: 'SELECT number FROM system.numbers_mt LIMIT 5',
    format: 'JSONEachRow', // or JSONCompactEachRow, JSONStringsEachRow, etc.
  })
  const stream = rows.stream()
  stream.on('data', (rows: Array<Row>) => {
    rows.forEach((row: Row) => {
      console.log(row.json()) // or `row.text` to avoid parsing JSON
    })
  })
  await new Promise((resolve, reject) => {
    stream.on('end', () => {
      console.log('Completed!')
      resolve(0)
    })
    stream.on('error', reject)
  })
  await client.close()
  process.exit(0)
})()
