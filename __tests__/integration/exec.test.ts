import type { ExecParams, ResponseJSON } from '../../src'
import { type ClickHouseClient } from '../../src'
import {
  createTestClient,
  getClickHouseTestEnvironment,
  getTestDatabaseName,
  guid,
  TestEnv,
} from '../utils'
import { getAsText } from '../../src/utils'
import * as uuid from 'uuid'
import type { QueryResult } from '../../src/connection'

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

    const { query_id } = await runCommand({
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

    const { query_id: q_id } = await runCommand({
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
    await expect(async () => {
      const command = () =>
        runCommand({
          query: ddl,
        })
      await command()
      await command()
    }).rejects.toEqual(
      expect.objectContaining({
        code: '57',
        type: 'TABLE_ALREADY_EXISTS',
        message: expect.stringContaining(
          `Table ${getTestDatabaseName()}.${tableName} already exists. `
        ),
      })
    )
  })

  it('should send a parametrized query', async () => {
    const result = await client.exec({
      query: 'SELECT plus({val1: Int32}, {val2: Int32})',
      query_params: {
        val1: 10,
        val2: 20,
      },
    })
    expect(await getAsText(result.stream)).toEqual('30\n')
  })

  describe('trailing semi', () => {
    it('should allow commands with semi in select clause', async () => {
      const result = await client.exec({
        query: `SELECT ';' FORMAT CSV`,
      })
      expect(await getAsText(result.stream)).toEqual('";"\n')
    })

    it('should allow commands with trailing semi', async () => {
      const result = await client.exec({
        query: 'EXISTS system.databases;',
      })
      expect(await getAsText(result.stream)).toEqual('1\n')
    })

    it('should allow commands with multiple trailing semi', async () => {
      const result = await client.exec({
        query: 'EXISTS system.foobar;;;;;;',
      })
      expect(await getAsText(result.stream)).toEqual('0\n')
    })
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
      await sessionClient.exec({
        query: 'CREATE TEMPORARY TABLE test_temp (val Int32)',
      })
    })
  })

  it.skip('can specify a parameterized query', async () => {
    await runCommand({
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

  async function runCommand(params: ExecParams): Promise<QueryResult> {
    console.log(
      `Running command with query_id ${params.query_id}:\n${params.query}`
    )
    return client.exec({
      ...params,
      clickhouse_settings: {
        // ClickHouse responds to a command when it's completely finished
        wait_end_of_query: 1,
      },
    })
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
