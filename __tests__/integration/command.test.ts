import type { CommandParams, ResponseJSON } from '../../src'
import { type ClickHouseClient } from '../../src'
import {
  createTestClient,
  getClickHouseTestEnvironment,
  getTestDatabaseName,
  guid,
  TestEnv,
} from '../utils'

describe('command', () => {
  let client: ClickHouseClient
  beforeEach(() => {
    client = createTestClient()
  })
  afterEach(async () => {
    await client.close()
  })

  it('sends a command to execute', async () => {
    const { ddl, tableName, engine } = getDDL()

    await runCommand(client, {
      query: ddl,
      format: 'JSONCompactEachRow',
    })

    const selectResult = await client.select({
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
  })

  it('does not swallow ClickHouse error', async () => {
    const { ddl, tableName } = getDDL()
    await expect(async () => {
      const command = () =>
        runCommand(client, {
          query: ddl,
          format: 'JSONCompactEachRow',
          clickhouse_settings: {
            // ClickHouse responds to a command when it's completely finished
            wait_end_of_query: 1,
          },
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
    const rows = await client.command({
      query: 'SELECT plus({val1: Int32}, {val2: Int32})',
      format: 'CSV',
      query_params: {
        val1: 10,
        val2: 20,
      },
    })
    expect(await rows.text()).toBe('30\n')
  })

  describe('trailing semi', () => {
    it('should allow queries with trailing semi', async () => {
      const numbers = await client.command({
        query: 'SELECT * FROM system.numbers LIMIT 3;',
        format: 'CSV',
      })
      expect(await numbers.text()).toEqual('0\n1\n2\n')
    })

    it('should allow queries with multiple trailing semis', async () => {
      const numbers = await client.command({
        query: 'SELECT * FROM system.numbers LIMIT 3;;;;;;;;;;;;;;;;;',
        format: 'CSV',
      })
      expect(await numbers.text()).toEqual('0\n1\n2\n')
    })

    it('should cut off the statements after the first semi', async () => {
      const numbers = await client.command({
        query: 'SELECT * FROM system.numbers LIMIT 3;asdf foobar',
        format: 'CSV',
      })
      expect(await numbers.text()).toEqual('0\n1\n2\n')
    })

    it('should allow commands without format but with trailing semi', async () => {
      const result = await client.command({
        query: 'EXISTS system.databases;',
        format: false,
      })
      expect(await result.text()).toEqual('1\n')
    })

    it('should allow commands without format but with multiple trailing semi', async () => {
      const result = await client.command({
        query: 'EXISTS system.foobar;;;;;;',
        format: false,
      })
      expect(await result.text()).toEqual('0\n')
    })
  })

  it.skip('can specify a parameterized query', async () => {
    await runCommand(client, {
      query: '',
      query_params: {
        table_name: 'example',
      },
    })

    // FIXME: use different DDL based on the TestEnv
    const result = await client.select({
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

async function runCommand(
  client: ClickHouseClient,
  params: CommandParams
): Promise<string> {
  console.log(`Running command:\n${params.query}`)
  return (await client.command(params)).text()
}
