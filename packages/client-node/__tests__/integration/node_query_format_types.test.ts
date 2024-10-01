import type {
  ClickHouseClient as BaseClickHouseClient,
  DataFormat,
} from '@clickhouse/client-common'
import { createTableWithFields } from '@test/fixtures/table_with_fields'
import { guid } from '@test/utils'
import type { ClickHouseClient, ResultSet } from '../../src'
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
      for await (const _rows of stream) {
        // $ExpectType Row<unknown, "JSONEachRow">[]
        const rows = _rows
        rows.length // avoid unused variable warning (rows reassigned for type assertion)
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
      }

      // stream + T hint + on('data')
      const streamTyped = rs.stream<Data>()
      await new Promise((resolve, reject) => {
        streamTyped
          .on(
            'data',
            // $ExpectType (rows: Row<Data, "JSONEachRow">[]) => void
            (rows) => {
              rows.forEach(
                // $ExpectType (row: Row<Data, "JSONEachRow">) => void
                (row) => {
                  // $ExpectType Data
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

      // stream + T hint + async iterator
      for await (const _rows of streamTyped) {
        // $ExpectType Row<Data, "JSONEachRow">[]
        const rows = _rows
        rows.length // avoid unused variable warning (rows reassigned for type assertion)
        rows.forEach(
          // $ExpectType (row: Row<Data, "JSONEachRow">) => void
          (row) => {
            // $ExpectType Data
            row.json()
            // $ExpectType Data
            row.json<Data>()
            // $ExpectType string
            row.text
          },
        )
      }
    })

    it('should infer ResultSet features when similar JSON formats are used in a function call', async () => {
      // $ExpectType (format: "JSONEachRow" | "JSONCompactEachRow") => Promise<ResultSet<"JSONEachRow" | "JSONCompactEachRow">>
      function runQuery(format: 'JSONEachRow' | 'JSONCompactEachRow') {
        return client.query({
          query,
          format,
        })
      }

      // ResultSet cannot infer the type from the literal, so it falls back to both possible formats.
      // However, these are both streamable, both can use JSON features, and both have the same data layout.

      //// JSONCompactEachRow

      // $ExpectType ResultSet<"JSONEachRow" | "JSONCompactEachRow">
      const rs = await runQuery('JSONCompactEachRow')
      // $ExpectType unknown[]
      await rs.json()
      // $ExpectType Data[]
      await rs.json<Data>()
      // $ExpectType string
      await rs.text()
      // $ExpectType StreamReadable<Row<unknown, "JSONEachRow" | "JSONCompactEachRow">[]>
      const stream = rs.stream()

      // stream + on('data')
      await new Promise((resolve, reject) => {
        stream
          .on(
            'data',
            // $ExpectType (rows: Row<unknown, "JSONEachRow" | "JSONCompactEachRow">[]) => void
            (rows) => {
              rows.forEach(
                // $ExpectType (row: Row<unknown, "JSONEachRow" | "JSONCompactEachRow">) => void
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
      for await (const _rows of stream) {
        // $ExpectType Row<unknown, "JSONEachRow" | "JSONCompactEachRow">[]
        const rows = _rows
        rows.length // avoid unused variable warning (rows reassigned for type assertion)
        rows.forEach(
          // $ExpectType (row: Row<unknown, "JSONEachRow" | "JSONCompactEachRow">) => void
          (row) => {
            // $ExpectType unknown
            row.json()
            // $ExpectType Data
            row.json<Data>()
            // $ExpectType string
            row.text
          },
        )
      }

      //// JSONEachRow

      // $ExpectType ResultSet<"JSONEachRow" | "JSONCompactEachRow">
      const rs2 = await runQuery('JSONEachRow')
      // $ExpectType unknown[]
      await rs2.json()
      // $ExpectType Data[]
      await rs2.json<Data>()
      // $ExpectType string
      await rs2.text()
      // $ExpectType StreamReadable<Row<unknown, "JSONEachRow" | "JSONCompactEachRow">[]>
      const stream2 = rs2.stream()

      // stream + on('data')
      await new Promise((resolve, reject) => {
        stream2
          .on(
            'data',
            // $ExpectType (rows: Row<unknown, "JSONEachRow" | "JSONCompactEachRow">[]) => void
            (rows) => {
              rows.forEach(
                // $ExpectType (row: Row<unknown, "JSONEachRow" | "JSONCompactEachRow">) => void
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
      for await (const _rows of stream2) {
        // $ExpectType Row<unknown, "JSONEachRow" | "JSONCompactEachRow">[]
        const rows = _rows
        rows.length // avoid unused variable warning (rows reassigned for type assertion)
        rows.forEach(
          // $ExpectType (row: Row<unknown, "JSONEachRow" | "JSONCompactEachRow">) => void
          (row) => {
            // $ExpectType unknown
            row.json()
            // $ExpectType Data
            row.json<Data>()
            // $ExpectType string
            row.text
          },
        )
      }
    })

    /**
     * Not covered, but should behave similarly:
     *  'JSONStringsEachRow',
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
     * Not covered, but should behave similarly:
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
      for await (const _rows of stream) {
        // $ExpectType Row<unknown, "CSV">[]
        const rows = _rows
        rows.length // avoid unused variable warning (rows reassigned for type assertion)
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

    it('should infer ResultSet features when similar raw formats are used in a function call', async () => {
      // $ExpectType (format: "CSV" | "TabSeparated") => Promise<ResultSet<"CSV" | "TabSeparated">>
      function runQuery(format: 'CSV' | 'TabSeparated') {
        return client.query({
          query,
          format,
        })
      }

      // ResultSet cannot infer the type from the literal, so it falls back to both possible formats.
      // However, these are both streamable, and both cannot use JSON features.

      //// CSV

      // $ExpectType ResultSet<"CSV" | "TabSeparated">
      const rs = await runQuery('CSV')
      // $ExpectType never
      await rs.json()
      // $ExpectType never
      await rs.json<Data>()
      // $ExpectType string
      await rs.text()
      // $ExpectType StreamReadable<Row<unknown, "CSV" | "TabSeparated">[]>
      const stream = rs.stream()

      // stream + on('data')
      await new Promise((resolve, reject) => {
        stream
          .on(
            'data',
            // $ExpectType (rows: Row<unknown, "CSV" | "TabSeparated">[]) => void
            (rows) => {
              rows.forEach(
                // $ExpectType (row: Row<unknown, "CSV" | "TabSeparated">) => void
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
      for await (const _rows of stream) {
        // $ExpectType Row<unknown, "CSV" | "TabSeparated">[]
        const rows = _rows
        rows.length // avoid unused variable warning (rows reassigned for type assertion)
        rows.forEach(
          // $ExpectType (row: Row<unknown, "CSV" | "TabSeparated">) => void
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

      //// TabSeparated

      // $ExpectType ResultSet<"CSV" | "TabSeparated">
      const rs2 = await runQuery('TabSeparated')
      // $ExpectType never
      await rs2.json()
      // $ExpectType never
      await rs2.json<Data>()
      // $ExpectType string
      await rs2.text()
      // $ExpectType StreamReadable<Row<unknown, "CSV" | "TabSeparated">[]>
      const stream2 = rs2.stream()

      // stream + on('data')
      await new Promise((resolve, reject) => {
        stream2
          .on(
            'data',
            // $ExpectType (rows: Row<unknown, "CSV" | "TabSeparated">[]) => void
            (rows) => {
              rows.forEach(
                // $ExpectType (row: Row<unknown, "CSV" | "TabSeparated">) => void
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
      for await (const _rows of stream2) {
        // $ExpectType Row<unknown, "CSV" | "TabSeparated">[]
        const rows = _rows
        rows.length // avoid unused variable warning (rows reassigned for type assertion)
        rows.forEach(
          // $ExpectType (row: Row<unknown, "CSV" | "TabSeparated">) => void
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
     * Not covered, but should behave similarly:
     *  'CSVWithNames',
     *  'CSVWithNamesAndTypes',
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
    // expect-type itself fails a bit here sometimes. It can get a wrong order of the variants = flaky ESLint run.
    type JSONFormat = 'JSON' | 'JSONEachRow'
    type ResultSetJSONFormat = ResultSet<JSONFormat>

    // TODO: Maybe there is a way to infer the format without an extra type parameter?
    it('should infer types for JSON or JSONEachRow (no extra type params)', async () => {
      function runQuery(format: JSONFormat): Promise<ResultSetJSONFormat> {
        return client.query({
          query,
          format,
        })
      }

      // ResultSet falls back to both possible formats (both JSON and JSONEachRow); 'JSON' string provided to `runQuery`
      // cannot be used to narrow down the literal type, since the function argument is just DataFormat.
      // $ExpectType ResultSetJSONFormat
      const rs = await runQuery('JSON')
      // $ExpectType unknown[] | ResponseJSON<unknown>
      await rs.json()
      // $ExpectType Data[] | ResponseJSON<Data>
      await rs.json<Data>()
      // $ExpectType string
      await rs.text()
      // $ExpectType StreamReadable<Row<unknown, JSONFormat>[]>
      rs.stream()
    })

    it('should infer types for JSON or JSONEachRow (with extra type parameter)', async () => {
      // $ExpectType <F extends JSONFormat>(format: F) => Promise<QueryResult<F>>
      function runQuery<F extends JSONFormat>(format: F) {
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
      // In a separate function, which breaks the format inference from the literal (due to "generic" DataFormat usage)
      // $ExpectType (format: DataFormat) => Promise<ResultSet<unknown>>
      function runQuery(format: DataFormat) {
        return client.query({
          query,
          format,
        })
      }

      // ResultSet falls back to all possible formats; 'JSON' string provided as an argument to `runQuery`
      // cannot be used to narrow down the literal type, since the function argument is just DataFormat.
      // $ExpectType ResultSet<unknown>
      const rs = await runQuery('JSON')

      // All possible JSON variants are now allowed
      // FIXME: this line produces a ESLint error due to a different order (which is insignificant). -$ExpectType unknown[] | Record<string, unknown> | ResponseJSON<unknown>
      await rs.json() // IDE error here, different type order
      // $ExpectType Data[] | ResponseJSON<Data> | Record<string, Data>
      await rs.json<Data>()
      // $ExpectType string
      await rs.text()
      // Stream is still allowed (can't be inferred, so it is not "never")
      // $ExpectType StreamReadable<Row<unknown, unknown>[]>
      const stream = rs.stream()
      for await (const _rows of stream) {
        // $ExpectType Row<unknown, unknown>[]
        const rows = _rows
        rows.length // avoid unused variable warning (rows reassigned for type assertion)
        rows.forEach(
          // $ExpectType (row: Row<unknown, unknown>) => void
          (row) => {
            // $ExpectType unknown
            row.json()
            // $ExpectType Data
            row.json<Data>()
            // $ExpectType string
            row.text
          },
        )
      }
    })
  })
})

type Data = { id: number; name: string; sku: number[] }
