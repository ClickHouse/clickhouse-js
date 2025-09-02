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
        query: `SELECT * FROM ${tableName}`,
      })
      .then((r) => r.json())
    // 42 is not a string here due to output_format_json_quote_64bit_integers set to 0 in 25.8+ by default
    // and we specifically unset 1 that is used for all other tests in utils/client.ts due to readonly=2
    expect(result.data).toEqual([{ id: 42, name: 'hello', sku: [0, 1] }])
  })

  it('should fail to create a table', async () => {
    await expectAsync(
      createSimpleTable(client, `should_not_be_created_${guid()}`),
    ).toBeRejectedWith(
      jasmine.objectContaining({
        message: jasmine.stringContaining('Not enough privileges'),
      }),
    )
  })

  it('should fail to insert', async () => {
    await expectAsync(
      client.insert({
        table: tableName,
        values: [[43, 'foobar', [5, 25]]],
      }),
    ).toBeRejectedWith(
      jasmine.objectContaining({
        message: jasmine.stringContaining('Not enough privileges'),
      }),
    )
  })

  // TODO: find a way to restrict all the system tables access
  it('should fail to query system tables', async () => {
    const query = `SELECT * FROM system.users LIMIT 5`
    await expectAsync(client.query({ query })).toBeRejectedWith(
      jasmine.objectContaining({
        message: jasmine.stringContaining('Not enough privileges'),
      }),
    )
  })
})
