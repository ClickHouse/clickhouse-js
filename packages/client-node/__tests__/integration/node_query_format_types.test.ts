import type {
  ClickHouseClient as BaseClickHouseClient,
  DataFormat,
} from '@clickhouse/client-common'
import { createTableWithFields } from '@test/fixtures/table_with_fields'
import { guid } from '@test/utils'
import type { ClickHouseClient } from '../../src'
import { createNodeTestClient } from '../utils/node_client'

// Ignored and used only as a source for ESLint checks with $ExpectType
// See also: https://www.npmjs.com/package/eslint-plugin-expect-type
xdescribe('[Node.js] Query and ResultSet types', () => {
  let client: ClickHouseClient
  const tableName = `node_query_format_types_test_${guid()}`
  const query = `SELECT * FROM ${tableName} ORDER BY id ASC`

  beforeAll(async () => {
    client = createNodeTestClient()
    await createTableWithFields(
      client as BaseClickHouseClient,
      'name String, sku Array(UInt32)',
      {},
      tableName,
    )
    await client.insert({
      table: tableName,
      values: [
        { id: 42, name: 'foo', sku: [1, 2, 3] },
        { id: 43, name: 'bar', sku: [4, 5, 6] },
      ],
      format: 'JSONEachRow',
    })
  })
  afterAll(async () => {
    await client.close()
  })

  describe('Streamable JSON formats', () => {
    it('should infer types for JSONEachRow', async () => {
      // $ExpectType ResultSet<"JSONEachRow">
      const rs = await client.query({
        query,
        format: 'JSONEachRow',
      })
      // $ExpectType unknown[]
      await rs.json()
      // $ExpectType Data[]
      await rs.json<Data>()
      // $ExpectType string
      await rs.text()
      // $ExpectType StreamReadable<Row<unknown, "JSONEachRow">[]>
      const stream = rs.stream()

      // stream + on('data')
      await new Promise((resolve, reject) => {
        stream
          .on(
            'data',
            // $ExpectType (rows: Row<unknown, "JSONEachRow">[]) => void
            (rows) => {
              rows.forEach(
                // $ExpectType (row: Row<unknown, "JSONEachRow">) => void
                (row) => {
                  // $ExpectType unknown
                  row.json()
                  // $ExpectType Data
                  row.json<Data>()
                  // $ExpectType string
                  row.text
                },
              )
            },
          )
          .on('end', resolve)
          .on('error', reject)
      })

      // stream + async iterator
      for await (const rows of stream) {
        rows.forEach((row) => {
          // $ExpectType unknown
          row.json()
          // $ExpectType Data
          row.json<Data>()
          // $ExpectType string
          row.text
        })
      }
    })

    /**
     * TODO: the rest of the streamable JSON formats
     *  'JSONStringsEachRow',
     *  'JSONCompactEachRow',
     *  'JSONCompactStringsEachRow',
     *  'JSONCompactEachRowWithNames',
     *  'JSONCompactEachRowWithNamesAndTypes',
     *  'JSONCompactStringsEachRowWithNames',
     *  'JSONCompactStringsEachRowWithNamesAndTypes'
     */
  })

  describe('Single document JSON formats', () => {
    it('should infer types when the format is omitted (JSON)', async () => {
      // $ExpectType ResultSet<"JSON">
      const rs = await client.query({
        query,
      })
      // $ExpectType ResponseJSON<unknown>
      await rs.json()
      // $ExpectType ResponseJSON<Data>
      await rs.json<Data>()
      // $ExpectType string
      await rs.text()
      // $ExpectType never
      rs.stream()
    })

    it('should infer types for JSON', async () => {
      // $ExpectType ResultSet<"JSON">
      const rs = await client.query({
        query,
        format: 'JSON',
      })
      // $ExpectType ResponseJSON<unknown>
      await rs.json()
      // $ExpectType ResponseJSON<Data>
      await rs.json<Data>()
      // $ExpectType string
      await rs.text()
      // $ExpectType never
      rs.stream()
    })

    it('should infer types for JSONObjectEachRow', async () => {
      // $ExpectType ResultSet<"JSONObjectEachRow">
      const rs = await client.query({
        query,
        format: 'JSONObjectEachRow',
      })
      // $ExpectType Record<string, unknown>
      await rs.json()
      // $ExpectType Record<string, Data>
      await rs.json<Data>()
      // $ExpectType string
      await rs.text()
      // $ExpectType never
      rs.stream()
    })

    /**
     * TODO: the rest of the single document JSON formats
     *  'JSONStrings',
     *  'JSONCompact',
     *  'JSONCompactStrings',
     *  'JSONColumnsWithMetadata',
     */
  })

  describe('Raw formats', () => {
    it('should infer types for CSV', async () => {
      // $ExpectType ResultSet<"CSV">
      const rs = await client.query({
        query,
        format: 'CSV',
      })
      // $ExpectType never
      await rs.json()
      // $ExpectType never
      await rs.json<Data>()
      // $ExpectType string
      await rs.text()
      // $ExpectType StreamReadable<Row<unknown, "CSV">[]>
      const stream = rs.stream()

      // stream + on('data')
      await new Promise((resolve, reject) => {
        stream
          .on(
            'data',
            // $ExpectType (rows: Row<unknown, "CSV">[]) => void
            (rows) => {
              rows.forEach(
                // $ExpectType (row: Row<unknown, "CSV">) => void
                (row) => {
                  // $ExpectType never
                  row.json()
                  // $ExpectType never
                  row.json<Data>()
                  // $ExpectType string
                  row.text
                },
              )
            },
          )
          .on('end', resolve)
          .on('error', reject)
      })

      // stream + async iterator
      for await (const rows of stream) {
        rows.forEach(
          // $ExpectType (row: Row<unknown, "CSV">) => void
          (row) => {
            // $ExpectType never
            row.json()
            // $ExpectType never
            row.json<Data>()
            // $ExpectType string
            row.text
          },
        )
      }
    })

    /**
     * TODO: the rest of the raw formats
     *  'CSVWithNames',
     *  'CSVWithNamesAndTypes',
     *  'TabSeparated',
     *  'TabSeparatedRaw',
     *  'TabSeparatedWithNames',
     *  'TabSeparatedWithNamesAndTypes',
     *  'CustomSeparated',
     *  'CustomSeparatedWithNames',
     *  'CustomSeparatedWithNamesAndTypes',
     *  'Parquet',
     */
  })

  describe('Type inference with ambiguous format variants', () => {
    // FIXME: Maybe there is a way to infer the format without an extra type parameter?
    it('should infer types for JSON or JSONEachRow (no extra type params)', async () => {
      function runQuery(format: 'JSON' | 'JSONEachRow') {
        return client.query({
          query,
          format,
        })
      }
      // $ExpectType ResultSet<"JSONEachRow" | "JSON">
      const rs = await runQuery('JSON')
      // $ExpectType unknown[] | ResponseJSON<unknown>
      await rs.json()
      // $ExpectType Data[] | ResponseJSON<Data>
      await rs.json<Data>()
      // $ExpectType string
      await rs.text()
      // $ExpectType StreamReadable<Row<unknown, "JSONEachRow">[]>
      rs.stream()
    })

    it('should infer types for JSON or JSONEachRow (with extra type parameter)', async () => {
      function runQuery<F extends 'JSON' | 'JSONEachRow'>(format: F) {
        return client.query({
          query,
          format,
        })
      }
      // $ExpectType ResultSet<"JSON">
      const rs = await runQuery('JSON')
      // $ExpectType ResponseJSON<unknown>
      await rs.json()
      // $ExpectType ResponseJSON<Data>
      await rs.json<Data>()
      // $ExpectType string
      await rs.text()
      // $ExpectType never
      rs.stream()

      // $ExpectType ResultSet<"JSONEachRow">
      const rs2 = await runQuery('JSONEachRow')
      // $ExpectType unknown[]
      await rs2.json()
      // $ExpectType Data[]
      await rs2.json<Data>()
      // $ExpectType string
      await rs2.text()
      // $ExpectType StreamReadable<Row<unknown, "JSONEachRow">[]>
      rs2.stream()
    })

    it('should fail to infer the types when the format is any', async () => {
      // In a separate function, which breaks the format inference from the literal (due to DataFormat usage)
      function runQuery(format: DataFormat) {
        return client.query({
          query,
          format,
        })
      }

      // ResultSet falls back to all possible formats (ResultSet type prints all possible formats)
      // $ExpectType ResultSet<"JSONEachRow" | "JSONStringsEachRow" | "JSONCompactEachRow" | "JSONCompactStringsEachRow" | "JSONCompactEachRowWithNames" | "JSONCompactEachRowWithNamesAndTypes" | "JSONCompactStringsEachRowWithNames" | "JSONCompactStringsEachRowWithNamesAndTypes" | "JSON" | "JSONStrings" | "JSONCompact" | "JSONCompactStrings" | "JSONColumnsWithMetadata" | "JSONObjectEachRow" | "CSV" | "CSVWithNames" | "CSVWithNamesAndTypes" | "TabSeparated" | "TabSeparatedRaw" | "TabSeparatedWithNames" | "TabSeparatedWithNamesAndTypes" | "CustomSeparated" | "CustomSeparatedWithNames" | "CustomSeparatedWithNamesAndTypes" | "Parquet">
      const rs = await runQuery('JSON')

      // All possible JSON variants are now allowed
      // $ExpectType unknown[] | ResponseJSON<unknown> | Record<string, unknown>
      await rs.json()
      // $ExpectType Data[] | ResponseJSON<Data> | Record<string, Data>
      await rs.json<Data>()
      // $ExpectType string
      await rs.text()
      // Stream is still allowed (can't be inferred, so it is not "never")
      const stream = rs.stream()
      for await (const rows of stream) {
        rows.forEach((row) => {
          // $ExpectType unknown
          row.json()
          // $ExpectType Data
          row.json<Data>()
          // $ExpectType string
          row.text
        })
      }
    })
  })
})

type Data = { id: number; name: string; sku: number[] }
