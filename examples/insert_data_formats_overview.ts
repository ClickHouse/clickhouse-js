import { createClient } from '@clickhouse/client'
import type { DataFormat } from '@clickhouse/client-common'
import {
  type InputJSON,
  type InputJSONObjectEachRow,
} from '@clickhouse/client-common'

/**
 * An overview of available formats for inserting your data, mainly in different JSON formats.
 * For "raw" formats, such as:
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
 *  - Parquet
 *  insert method requires a Stream as its input; see the streaming examples:
 *  - streaming from a CSV file - node/insert_file_stream_csv.ts
 *  - streaming from a Parquet file - node/insert_file_stream_parquet.ts
 *
 * See also:
 * - ClickHouse formats documentation - https://clickhouse.com/docs/en/interfaces/formats
 * - SELECT formats overview - select_data_formats_overview.ts
 */
void (async () => {
  const tableName = 'insert_data_formats_overview'
  const client = createClient()
  await prepareTestTable()

  // These JSON formats can be streamed as well instead of sending the entire data set at once;
  // See this example that streams a file: node/insert_file_stream_ndjson.ts
  console.log('#### Streamable JSON formats:\n')
  // All of these formats accept various arrays of objects, depending on the format.
  await insertJSON('JSONEachRow', [
    { id: 1, name: 'foo', sku: [1, 2, 3] },
    { id: 2, name: 'bar', sku: [4, 5, 6] },
  ])
  await insertJSON('JSONStringsEachRow', [
    { id: '3', name: 'foo', sku: '[1,2,3]' },
    { id: '4', name: 'bar', sku: '[4,5,6]' },
  ])
  await insertJSON('JSONCompactEachRow', [
    [5, 'foo', [1, 2, 3]],
    [6, 'bar', [4, 5, 6]],
  ])
  await insertJSON('JSONCompactStringsEachRow', [
    ['7', 'foo', '[1,2,3]'],
    ['8', 'bar', '[4,5,6]'],
  ])
  await insertJSON('JSONCompactEachRowWithNames', [
    ['id', 'name', 'sku'],
    [9, 'foo', [1, 2, 3]],
    [10, 'bar', [4, 5, 6]],
  ])
  await insertJSON('JSONCompactEachRowWithNamesAndTypes', [
    ['id', 'name', 'sku'],
    ['UInt32', 'String', 'Array(UInt32)'],
    [11, 'foo', [1, 2, 3]],
    [12, 'bar', [4, 5, 6]],
  ])
  await insertJSON('JSONCompactStringsEachRowWithNames', [
    ['id', 'name', 'sku'],
    ['13', 'foo', '[1,2,3]'],
    ['14', 'bar', '[4,5,6]'],
  ])
  await insertJSON('JSONCompactStringsEachRowWithNamesAndTypes', [
    ['id', 'name', 'sku'],
    ['UInt32', 'String', 'Array(UInt32)'],
    ['15', 'foo', '[1,2,3]'],
    ['16', 'bar', '[4,5,6]'],
  ])

  // These are single document JSON formats, which are not streamable
  console.log('\n#### Single document JSON formats:\n')
  // JSON, JSONCompact, JSONColumnsWithMetadata accept the InputJSON<T> shape.
  // For example: https://clickhouse.com/docs/en/interfaces/formats#json
  const meta: InputJSON['meta'] = [
    { name: 'id', type: 'UInt32' },
    { name: 'name', type: 'String' },
    { name: 'sku', type: 'Array(UInt32)' },
  ]
  await insertJSON('JSON', {
    meta: [], // not required for JSON format input
    data: [
      { id: 17, name: 'foo', sku: [1, 2, 3] },
      { id: 18, name: 'bar', sku: [4, 5, 6] },
    ],
  })
  await insertJSON('JSONCompact', {
    meta,
    data: [
      [19, 'foo', [1, 2, 3]],
      [20, 'bar', [4, 5, 6]],
    ],
  })
  await insertJSON('JSONColumnsWithMetadata', {
    meta,
    data: {
      id: [21, 22],
      name: ['foo', 'bar'],
      sku: [
        [1, 2, 3],
        [4, 5, 6],
      ],
    },
  })

  // JSONObjectEachRow accepts Record<string, T> (alias: InputJSONObjectEachRow<T>).
  // See https://clickhouse.com/docs/en/interfaces/formats#jsonobjecteachrow
  await insertJSON('JSONObjectEachRow', {
    row_1: { id: 23, name: 'foo', sku: [1, 2, 3] },
    row_2: { id: 24, name: 'bar', sku: [4, 5, 6] },
  })

  // Print the inserted data - see that the IDs are matching.
  await printInsertedData()
  await client.close()

  // Inserting data in different JSON formats
  async function insertJSON<T = unknown>(
    format: DataFormat,
    values: ReadonlyArray<T> | InputJSON<T> | InputJSONObjectEachRow<T>
  ) {
    try {
      await client.insert({
        table: tableName,
        format: format,
        values,
      })
      console.log(`Successfully inserted data with format ${format}`)
    } catch (err) {
      console.error(`Failed to insert data with format ${format}, cause:`, err)
      process.exit(1)
    }
  }

  async function prepareTestTable() {
    await client.command({
      query: `
        CREATE OR REPLACE TABLE ${tableName}
        (id UInt32, name String, sku Array(UInt32))
        ENGINE MergeTree()
        ORDER BY (id)
      `,
    })
  }

  async function printInsertedData() {
    const resultSet = await client.query({
      query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
      format: 'JSONEachRow',
    })
    const data = await resultSet.json()
    console.log('Inserted data:')
    console.dir(data, { depth: null })
  }
})()
