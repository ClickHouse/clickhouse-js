import type { ExecParams } from '@clickhouse/client-common'
import { type ClickHouseClient } from '@clickhouse/client-common'
import {
  createTestClient,
  getClickHouseTestEnvironment,
  getTestDatabaseName,
  guid,
  TestEnv,
  validateUUID,
} from '../utils'

describe('exec', () => {
  let client: ClickHouseClient
  beforeEach(() => {
    client = createTestClient()
  })
  afterEach(async () => {
    await client.close()
  })

  it('sends a command to execute', async () => {
    const { ddl, tableName, engine } = getDDL()

    const { query_id } = await runExec({
      query: ddl,
    })

    // generated automatically
    expect(validateUUID(query_id)).toBeTruthy()

    await checkCreatedTable({
      tableName,
      engine,
    })
  })

  it('should use query_id override', async () => {
    const { ddl, tableName, engine } = getDDL()

    const query_id = guid()

    const { query_id: q_id } = await runExec({
      query: ddl,
      query_id,
    })
    expect(query_id).toEqual(q_id)

    await checkCreatedTable({
      tableName,
      engine,
    })
  })

  it('does not swallow ClickHouse error', async () => {
    const { ddl, tableName } = getDDL()
    const commands = async () => {
      const command = () =>
        runExec({
          query: ddl,
        })
      await command()
      await command()
    }
    await expectAsync(commands()).toBeRejectedWith(
      jasmine.objectContaining({
        code: '57',
        type: 'TABLE_ALREADY_EXISTS',
        message: jasmine.stringContaining(
          `Table ${getTestDatabaseName()}.${tableName} already exists. `,
        ),
      }),
    )
  })

  it('can specify a parameterized query', async () => {
    const result = await client.query({
      query: `SELECT * from system.tables where name = 'numbers'`,
      format: 'JSON',
    })

    const json = await result.json<{ name: string }>()
    expect(json.rows).toBe(1)
    expect(json.data[0].name).toBe('numbers')
  })

  async function checkCreatedTable({
    tableName,
    engine,
  }: {
    tableName: string
    engine: string
  }) {
    const selectResult = await client.query({
      query: `SELECT * from system.tables where name = '${tableName}'`,
      format: 'JSON',
    })

    const { data, rows } = await selectResult.json<{
      name: string
      engine: string
      create_table_query: string
    }>()

    expect(rows).toBe(1)
    const table = data[0]
    expect(table.name).toBe(tableName)
    expect(table.engine).toBe(engine)
    expect(typeof table.create_table_query).toBe('string')
  }

  async function runExec(params: ExecParams): Promise<{ query_id: string }> {
    const { query_id } = await client.exec({
      ...params,
      clickhouse_settings: {
        // ClickHouse responds to a command when it's completely finished
        wait_end_of_query: 1,
      },
    })
    return { query_id }
  }
})

function getDDL(): {
  ddl: string
  tableName: string
  engine: string
} {
  const env = getClickHouseTestEnvironment()
  const tableName = `command_test_${guid()}`
  switch (env) {
    // ENGINE and ON CLUSTER can be omitted in the cloud statements.
    // It will use Shared (CloudSMT)/Replicated (Cloud) MergeTree by default.
    case TestEnv.CloudSMT: {
      const ddl = `
        CREATE TABLE ${tableName}
        (id UInt64, name String, sku Array(UInt8), timestamp DateTime)
        ORDER BY (id)
      `
      return { ddl, tableName, engine: 'SharedMergeTree' }
    }
    case TestEnv.Cloud: {
      const ddl = `
        CREATE TABLE ${tableName}
        (id UInt64, name String, sku Array(UInt8), timestamp DateTime)
        ORDER BY (id)
      `
      return { ddl, tableName, engine: 'ReplicatedMergeTree' }
    }
    case TestEnv.LocalSingleNode: {
      const ddl = `
        CREATE TABLE ${tableName}
        (id UInt64, name String, sku Array(UInt8), timestamp DateTime)
        ENGINE = MergeTree()
        ORDER BY (id)
      `
      return { ddl, tableName, engine: 'MergeTree' }
    }

    case TestEnv.LocalCluster: {
      const ddl = `
        CREATE TABLE ${tableName} ON CLUSTER '{cluster}'
        (id UInt64, name String, sku Array(UInt8), timestamp DateTime)
        ENGINE ReplicatedMergeTree('/clickhouse/{cluster}/tables/{database}/{table}/{shard}', '{replica}')
        ORDER BY (id)
      `
      return { ddl, tableName, engine: 'ReplicatedMergeTree' }
    }
  }
}
