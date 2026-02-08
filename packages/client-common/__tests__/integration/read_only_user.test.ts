import { describe, it, expect } from 'vitest'
import type { ClickHouseClient } from '@clickhouse/client-common'
import { isCloudTestEnv } from '@test/utils/test_env'
import { createReadOnlyUser } from '../fixtures/read_only_user'
import { createSimpleTable } from '../fixtures/simple_table'
import { createTestClient, getTestDatabaseName, guid } from '../utils'

describe('read only user', () => {
  let defaultClient: ClickHouseClient
  let client: ClickHouseClient
  let tableName: string
  let userName: string

  beforeAll(async () => {
    const database = getTestDatabaseName()
    defaultClient = createTestClient()

    const credentials = await createReadOnlyUser(defaultClient)
    userName = credentials.username

    // Populate some test table to select from
    tableName = `read_only_user_data_${guid()}`
    await createSimpleTable(defaultClient, tableName)
    await defaultClient.insert({
      table: tableName,
      values: [[42, 'hello', [0, 1]]],
    })

    // Create a client that connects read only user to the test database
    client = createTestClient({
      database,
      username: credentials.username,
      password: credentials.password,
      clickhouse_settings: {
        // readonly user cannot adjust settings. reset the default ones set by fixtures.
        // might be fixed by https://github.com/ClickHouse/ClickHouse/issues/40244
        insert_quorum: undefined,
        database_replicated_enforce_synchronous_settings: undefined,
        output_format_json_quote_64bit_integers: undefined,
      },
    })
  })

  afterAll(async () => {
    if (isCloudTestEnv()) {
      await defaultClient.command({
        query: `DROP USER IF EXISTS ${userName}`,
      })
    }
    await client.close()
    await defaultClient.close()
  })

  it('should select some data without issues', async () => {
    const result = await client
      .query({
        query: `SELECT name, sku FROM ${tableName}`,
      })
      .then((r) => r.json())
    expect(result.data).toEqual([{ name: 'hello', sku: [0, 1] }])
  })

  it('should fail to create a table', async () => {
    await expect(
      createSimpleTable(client, `should_not_be_created_${guid()}`),
    ).rejects.toMatchObject(
      expect.objectContaining({
        message: expect.stringContaining('Not enough privileges'),
      }),
    )
  })

  it('should fail to insert', async () => {
    await expect(
      client.insert({
        table: tableName,
        values: [[43, 'foobar', [5, 25]]],
      }),
    ).rejects.toMatchObject(
      expect.objectContaining({
        message: expect.stringContaining('Not enough privileges'),
      }),
    )
  })

  // TODO: find a way to restrict all the system tables access
  it('should fail to query system tables', async () => {
    const query = `SELECT * FROM system.users LIMIT 5`
    await expect(client.query({ query })).rejects.toMatchObject(
      expect.objectContaining({
        message: expect.stringContaining('Not enough privileges'),
      }),
    )
  })
})
