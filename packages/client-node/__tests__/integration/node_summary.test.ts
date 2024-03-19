import type {
  ClickHouseClient,
  ClickHouseSettings,
} from '@clickhouse/client-common'
import { createSimpleTable } from '@test/fixtures/simple_table'
import { jsonValues } from '@test/fixtures/test_data'
import { createTestClient, guid } from '@test/utils'
import type Stream from 'stream'

// FIXME: figure out if we can get non-flaky assertion with an SMT Cloud instance.
//  It could be that it requires full quorum settings for non-flaky assertions.
//  SharedMergeTree Cloud instance is auto by default (and cannot be modified).
// whenOnEnv(
//   TestEnv.LocalSingleNode,
//   TestEnv.LocalCluster,
//   TestEnv.Cloud
// ).
describe('[Node.js] Summary header parsing', () => {
  let client: ClickHouseClient<Stream.Readable>
  let tableName: string

  // otherwise, the summary might not be correct for an SMT instance
  const settings: ClickHouseSettings = {
    wait_end_of_query: 1,
  }

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
      clickhouse_settings: settings,
    })
    expect(insertSummary).toEqual({
      read_rows: '5',
      read_bytes: jasmine.any(String),
      written_rows: '5',
      written_bytes: jasmine.any(String),
      total_rows_to_read: '0',
      result_rows: '5',
      result_bytes: jasmine.any(String),
      elapsed_ns: jasmine.any(String),
    })

    const { summary: execSummary } = await client.exec({
      query: `INSERT INTO ${tableName} SELECT * FROM ${tableName}`,
      clickhouse_settings: settings,
    })
    expect(execSummary).toEqual({
      read_rows: '5',
      read_bytes: jasmine.any(String),
      written_rows: '5',
      written_bytes: jasmine.any(String),
      total_rows_to_read: '5',
      result_rows: '5',
      result_bytes: jasmine.any(String),
      elapsed_ns: jasmine.any(String),
    })
  })

  it('should provide summary for command', async () => {
    const { summary } = await client.command({
      query: `INSERT INTO ${tableName} VALUES (144, 'Hello', [2, 4]), (255, 'World', [3, 5])`,
      clickhouse_settings: settings,
    })
    expect(summary).toEqual({
      read_rows: '2',
      read_bytes: jasmine.any(String),
      written_rows: '2',
      written_bytes: jasmine.any(String),
      total_rows_to_read: '0',
      result_rows: '2',
      result_bytes: jasmine.any(String),
      elapsed_ns: jasmine.any(String),
    })
  })
})
