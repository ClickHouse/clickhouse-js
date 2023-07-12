import type { ExecParams, ResponseJSON } from '@clickhouse/client-common'
import { type ClickHouseClient } from '@clickhouse/client-common'
import {
  createTestClient,
  getClickHouseTestEnvironment,
  getTestDatabaseName,
  guid,
  TestEnv,
} from '../utils'
import * as uuid from 'uuid'

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
    expect(uuid.validate(query_id)).toBeTruthy()

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
          `Table ${getTestDatabaseName()}.${tableName} already exists. `
        ),
      })
    )
  })

  describe('sessions', () => {
    let sessionClient: ClickHouseClient
    beforeEach(() => {
      sessionClient = createTestClient({
        session_id: `test-session-${guid()}`,
      })
    })
    afterEach(async () => {
      await sessionClient.close()
    })

    it('should allow the use of a session', async () => {
      // Temporary tables cannot be used without a session
      const tableName = `temp_table_${guid()}`
      await expectAsync(
        sessionClient.exec({
          query: `CREATE TEMPORARY TABLE ${tableName} (val Int32)`,
        })
      ).toBeResolved()
    })
  })

  xit('can specify a parameterized query', async () => {
    await runExec({
      query: '',
      query_params: {
        table_name: 'example',
      },
    })

    // FIXME: use different DDL based on the TestEnv
    const result = await client.query({
      query: `SELECT * from system.tables where name = 'example'`,
      format: 'JSON',
    })

    const { data, rows } = await result.json<
      ResponseJSON<{ name: string; engine: string; create_table_query: string }>
    >()

    expect(rows).toBe(1)
    const table = data[0]
    expect(table.name).toBe('example')
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

    const { data, rows } = await selectResult.json<
      ResponseJSON<{ name: string; engine: string; create_table_query: string }>
    >()

    expect(rows).toBe(1)
    const table = data[0]
    expect(table.name).toBe(tableName)
    expect(table.engine).toBe(engine)
    expect(typeof table.create_table_query).toBe('string')
  }

  async function runExec(params: ExecParams): Promise<{ query_id: string }> {
    console.log(
      `Running command with query_id ${params.query_id}:\n${params.query}`
    )
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
    // ENGINE can be omitted in the cloud statements:
    // it will use ReplicatedMergeTree and will add ON CLUSTER as well
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
