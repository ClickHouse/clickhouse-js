import { createClient } from '@clickhouse/client'
import type { DataFormat } from '@clickhouse/client-common'

/**
 * An overview of all available formats for selecting your data.
 * Run this example and see the shape of the parsed data for different formats.
 *
 * An example of console output is available here: https://gist.github.com/slvrtrn/3ad657c4e236e089a234d79b87600f76
 *
 * See also:
 * - ClickHouse formats documentation - https://clickhouse.com/docs/en/interfaces/formats
 * - INSERT formats overview - insert_data_formats_overview.ts
 * - JSON data streaming example - select_streaming_json_each_row.ts
 * - Streaming Parquet into a file - node/select_parquet_as_file.ts
 */
void (async () => {
  const tableName = 'select_data_formats_overview'
  const client = createClient()
  await prepareTestData()

  // These ClickHouse JSON formats can be streamed as well instead of loading the entire result into the app memory;
  // See this example: node/select_streaming_json_each_row.ts
  console.log('#### Streamable JSON formats:\n')
  await selectJSON('JSONEachRow')
  await selectJSON('JSONStringsEachRow')
  await selectJSON('JSONCompactEachRow')
  await selectJSON('JSONCompactStringsEachRow')
  await selectJSON('JSONCompactEachRowWithNames')
  await selectJSON('JSONCompactEachRowWithNamesAndTypes')
  await selectJSON('JSONCompactStringsEachRowWithNames')
  await selectJSON('JSONCompactStringsEachRowWithNamesAndTypes')

  // These are single document ClickHouse JSON formats, which are not streamable
  console.log('\n#### Single document JSON formats:\n')
  await selectJSON('JSON')
  await selectJSON('JSONStrings')
  await selectJSON('JSONCompact')
  await selectJSON('JSONCompactStrings')
  await selectJSON('JSONColumnsWithMetadata')
  await selectJSON('JSONObjectEachRow')

  // These "raw" ClickHouse formats can be streamed as well instead of loading the entire result into the app memory;
  // see node/select_streaming_text_line_by_line.ts
  console.log('\n#### Raw formats:\n')
  await selectText('CSV')
  await selectText('CSVWithNames')
  await selectText('CSVWithNamesAndTypes')
  await selectText('TabSeparated')
  await selectText('TabSeparatedRaw')
  await selectText('TabSeparatedWithNames')
  await selectText('TabSeparatedWithNamesAndTypes')
  await selectText('CustomSeparated')
  await selectText('CustomSeparatedWithNames')
  await selectText('CustomSeparatedWithNamesAndTypes')

  // Parquet can be streamed in and out, too.
  // See node/select_parquet_as_file.ts, node/insert_file_stream_parquet.ts

  await client.close()

  // Selecting data in different JSON formats
  async function selectJSON(format: DataFormat) {
    const rows = await client.query({
      query: `SELECT * FROM ${tableName} LIMIT 10`, // don't use FORMAT clause; specify the format separately
      format: format,
    })
    const data = await rows.json() // get all the data at once
    console.log(`Format: ${format}, parsed data:`)
    console.dir(data, { depth: null }) // prints the nested arrays, too
  }

  // Selecting text data in different formats; `.json()` cannot be used here as it does not make sense.
  async function selectText(format: DataFormat) {
    const rows = await client.query({
      query: `SELECT * FROM ${tableName} LIMIT 10`, // don't use FORMAT clause; specify the format separately
      format: format,
      clickhouse_settings: {
        // This is for CustomSeparated format demo purposes.
        // See also: https://clickhouse.com/docs/en/interfaces/formats#format-customseparated
        format_custom_field_delimiter: ' | ',
      },
    })
    const data = await rows.text() // get all the data at once
    console.log(`Format: ${format}, text data:`)
    console.log(data)
  }

  async function prepareTestData() {
    await client.command({
      query: `
        CREATE OR REPLACE TABLE ${tableName}
        (id UInt32, name String, sku Array(UInt32))
        ENGINE MergeTree()
        ORDER BY (id)
      `,
    })
    // See also: INSERT formats overview - insert_data_formats_overview.ts
    await client.insert({
      table: tableName,
      values: [
        { id: 42, name: 'foo', sku: [1, 2, 3] },
        { id: 43, name: 'bar', sku: [4, 5, 6] },
      ],
      format: 'JSONEachRow',
    })
  }
})()
