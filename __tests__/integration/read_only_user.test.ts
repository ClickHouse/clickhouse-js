import { ClickHouseClient } from '../../src'
import {
  createTestClient,
  getClickHouseTestEnvironment,
  getTestDatabaseName,
  guid,
  TestEnv,
} from '../utils'
import { createSimpleTable } from './fixtures/simple_table'

describe('read only user', () => {
  let client: ClickHouseClient
  let username: string
  let tableName: string
  beforeAll(async () => {
    username = `clickhousejs__read_only_user_${guid()}`
    const database = getTestDatabaseName()
    const defaultClient = createTestClient()
    const env = getClickHouseTestEnvironment()

    // Bootstrap read only user
    let createUser: string
    let grant: string
    switch (env) {
      case TestEnv.LocalSingleNode:
        createUser = `
          CREATE USER ${username} 
          DEFAULT DATABASE ${database}
          SETTINGS readonly = 1
        `
        grant = `
          GRANT SHOW TABLES, SELECT 
          ON ${database}.* 
          TO ${username}
        `
        break
      case TestEnv.Cloud:
      case TestEnv.LocalCluster:
        createUser = `
          CREATE USER ${username} 
          ON CLUSTER '{cluster}'
          DEFAULT DATABASE ${database}
          SETTINGS readonly = 1
        `
        grant = `
          GRANT ON CLUSTER '{cluster}'
          SHOW TABLES, SELECT 
          ON ${database}.* 
          TO ${username}
        `
        break
    }
    await defaultClient
      .command({ query: createUser, format: null })
      .then((r) => r.text())
    await defaultClient
      .command({ query: grant, format: null })
      .then((r) => r.text())
    console.log(`Created user ${username} with default database ${database}`)

    // Populate some test table to select from
    tableName = `read_only_user_data_${guid()}`
    await createSimpleTable(defaultClient, tableName)
    await defaultClient.insert({
      table: tableName,
      values: [[42, 'hello', [0, 1]]],
    })

    await defaultClient.close()

    // Create a client that connects read only user to the test database
    client = createTestClient({
      username,
      database,
      clickhouse_settings: {
        insert_quorum: undefined,
      },
      compression: {
        response: false, // cannot enable HTTP compression for a read only user
      },
    })
  })
  afterAll(async () => {
    await client.close()
  })

  it('should select some data without issues', async () => {
    const result = await client
      .select({
        query: `SELECT * FROM ${tableName}`,
      })
      .then((r) => r.json<{ data: unknown[] }>())
    expect(result.data).toEqual([{ id: '42', name: 'hello', sku: [0, 1] }])
  })

  it('should fail to create a table', async () => {
    await expect(
      createSimpleTable(client, `should_not_be_created_${guid()}`)
    ).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringContaining(
          'Not enough privileges. ' +
            `To execute this query it's necessary to have grant CREATE TABLE`
        ),
      })
    )
  })

  it('should fail to insert', async () => {
    await expect(
      client.insert({
        table: tableName,
        values: [[43, 'foobar', [5, 25]]],
      })
    ).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringContaining(
          'Not enough privileges. ' +
            `To execute this query it's necessary to have grant INSERT`
        ),
      })
    )
  })

  // TODO: enabled by default
  //  we can try to restrict the access using https://clickhouse.com/docs/en/sql-reference/statements/create/row-policy/
  //  as suggested in https://github.com/ClickHouse/ClickHouse/issues/2451#issuecomment-1162497824
  it.skip('should fail to query system tables', async () => {
    const query = `SELECT * FROM system.data_type_families`
    await expect(
      client.command({ query }).then((r) => r.text())
    ).rejects.toThrowError()
  })
})
