import { describe, it, expect } from 'vitest'
import type { ClickHouseClient } from '@clickhouse/client-common'
import { createSimpleTable } from '@test/fixtures/simple_table'
import { jsonValues } from '@test/fixtures/test_data'
import { createTestClient } from '@test/utils/client'
import { guid } from '@test/utils/guid'
import { TestEnv, isOnEnv } from '@test/utils/test_env'
import type Stream from 'stream'

// FIXME: figure out if we can get non-flaky assertion with an SMT Cloud instance.
//  It could be that it requires full quorum settings for non-flaky assertions.
//  SharedMergeTree Cloud instance is auto by default (and cannot be modified).
describe.skipIf(!isOnEnv(TestEnv.LocalSingleNode, TestEnv.LocalCluster))(
  '[Node.js] Summary header parsing',
  () => {
    let client: ClickHouseClient<Stream.Readable>
    let tableName: string

    beforeAll(async () => {
      client = createTestClient()
      tableName = `summary_test_${guid()}`
      await createSimpleTable(client, tableName)
    })
    afterAll(async () => {
      await client.close()
    })

    it('should provide summary for insert/exec', async () => {
      const { summary: insertSummary } = await client.insert({
        table: tableName,
        values: jsonValues,
        format: 'JSONEachRow',
      })
      expect(insertSummary).toEqual(
        expect.objectContaining({
          read_rows: '5',
          read_bytes: expect.any(String),
          written_rows: '5',
          written_bytes: expect.any(String),
          result_rows: '5',
          result_bytes: expect.any(String),
          elapsed_ns: expect.any(String),
        }),
      )

      const { summary: execSummary } = await client.exec({
        query: `INSERT INTO ${tableName}
              SELECT *
              FROM ${tableName}`,
      })
      expect(execSummary).toEqual(
        expect.objectContaining({
          read_rows: '5',
          read_bytes: expect.any(String),
          written_rows: '5',
          written_bytes: expect.any(String),
          result_rows: '5',
          result_bytes: expect.any(String),
          elapsed_ns: expect.any(String),
        }),
      )
    })

    it('should provide summary for command', async () => {
      const { summary } = await client.command({
        query: `INSERT INTO ${tableName}
              VALUES (144, 'Hello', [2, 4]),
                     (255, 'World', [3, 5])`,
        clickhouse_settings: {
          wait_end_of_query: 1,
        },
      })
      expect(summary).toEqual(
        expect.objectContaining({
          read_rows: '2',
          read_bytes: expect.any(String),
          written_rows: '2',
          written_bytes: expect.any(String),
          result_rows: '2',
          result_bytes: expect.any(String),
          elapsed_ns: expect.any(String),
        }),
      )
    })
  },
)
