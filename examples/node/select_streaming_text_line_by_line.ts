import { createClient, type Row } from '@clickhouse/client'

/**
 * Can be used for consuming large datasets for reducing memory overhead,
 * or if your response exceeds built in Node.js limitations, such as 512Mb for strings.
 *
 * Each of the response chunks will be transformed into a relatively small arrays of rows instead
 * (the size of this array depends on the size of a particular chunk the client receives from the server,
 * as it may vary, and the size of an individual row), one chunk at a time.
 *
 * The following "raw" formats can be streamed:
 *  - CSV
 *  - CSVWithNames
 *  - CSVWithNamesAndTypes
 *  - TabSeparated
 *  - TabSeparatedRaw
 *  - TabSeparatedWithNames
 *  - TabSeparatedWithNamesAndTypes
 *  - CustomSeparated
 *  - CustomSeparatedWithNames
 *  - CustomSeparatedWithNamesAndTypes
 *  - Parquet (see also: select_parquet_as_file.ts)
 *
 * See other supported formats for streaming:
 * https://clickhouse.com/docs/en/integrations/language-clients/javascript#supported-data-formats
 */
void (async () => {
  const client = createClient()
  const rows = await client.query({
    query: 'SELECT number, number + 1 FROM system.numbers_mt LIMIT 5',
    format: 'CSV', // or TabSeparated, CustomSeparated, etc.
  })
  const stream = rows.stream()
  stream.on('data', (rows: Array<Row>) => {
    rows.forEach((row: Row) => {
      console.log(row.text)
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
