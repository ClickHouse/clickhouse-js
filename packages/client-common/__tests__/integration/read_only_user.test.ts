import type { ClickHouseClient } from '@clickhouse/client-common'
import { createReadOnlyUser } from '../fixtures/read_only_user'
import { createSimpleTable } from '../fixtures/simple_table'
import { createTestClient, getTestDatabaseName, guid } from '../utils'

describe('read only user', () => {
  let client: ClickHouseClient
  let tableName: string

  beforeAll(async () => {
    const database = getTestDatabaseName()
    const defaultClient = createTestClient()

    const { username, password } = await createReadOnlyUser(defaultClient)

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
      password,
      database,
      clickhouse_settings: {
        // readonly user cannot adjust settings. reset the default ones set by fixtures.
        // might be fixed by https://github.com/ClickHouse/ClickHouse/issues/40244
        insert_quorum: undefined,
        database_replicated_enforce_synchronous_settings: undefined,
      },
      readonly: true, // disables compression and additional ClickHouse HTTP settings
    })
  })

  afterAll(async () => {
    await client.close()
  })

  it('should select some data without issues', async () => {
    const result = await client
      .query({
        query: `SELECT * FROM ${tableName}`,
      })
      .then((r) => r.json<{ data: unknown[] }>())
    expect(result.data).toEqual([{ id: '42', name: 'hello', sku: [0, 1] }])
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
