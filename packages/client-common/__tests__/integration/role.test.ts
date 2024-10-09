import type { ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient, TestEnv, whenOnEnv } from '@test/utils'
import { getTestDatabaseName, guid } from '../utils'
import { createSimpleTable } from '../fixtures/simple_table'
import { assertJsonValues, jsonValues } from '../fixtures/test_data'

fdescribe('role settings', () => {
  let defaultClient: ClickHouseClient
  let client: ClickHouseClient

  let database: string
  let username: string
  let password: string
  let roleName1: string
  let roleName2: string

  beforeAll(async () => {
    defaultClient = createTestClient()
    username = `clickhousejs__user_with_roles_${guid()}`
    password = `CHJS_${guid()}`
    roleName1 = `TEST_ROLE_${guid()}`
    roleName2 = `TEST_ROLE_${guid()}`
    database = getTestDatabaseName()

    await defaultClient.command({
      query: `CREATE USER ${username} IDENTIFIED WITH sha256_password BY '${password}' DEFAULT DATABASE ${database}`,
    })
    await defaultClient.command({
      query: `CREATE ROLE IF NOT EXISTS ${roleName1}`,
    })
    await defaultClient.command({
      query: `CREATE ROLE IF NOT EXISTS ${roleName2}`,
    })
    await defaultClient.command({
      query: `GRANT ${roleName1}, ${roleName2} TO ${username}`,
    })
    await defaultClient.command({
      query: `GRANT INSERT ON ${database}.* TO ${roleName1}`,
    })
    await defaultClient.command({
      query: `GRANT CREATE TABLE ON * TO ${roleName1}`,
    })
  })

  afterEach(async () => {
    await client.close()
  })

  afterAll(async () => {
    await defaultClient.close()
  })

  describe('for queries', () => {
    async function queryCurrentRoles(role?: string | Array<string>) {
      const rs = await client.query({
        query: 'select currentRoles() as roles',
        format: 'JSONEachRow',
        role,
      })

      const jsonResults = (await rs.json()) as { roles: string[] }[]
      return jsonResults[0].roles
    }

    whenOnEnv(TestEnv.LocalSingleNode).it(
      'should use a single role from the client configuration',
      async () => {
        client = createTestClient({
          username,
          password,
          role: roleName1,
        })

        const actualRoles = await queryCurrentRoles()
        expect(actualRoles).toEqual([roleName1])
      },
    )

    whenOnEnv(TestEnv.LocalSingleNode).it(
      'should use multiple roles from the client configuration',
      async () => {
        client = createTestClient({
          username,
          password,
          role: [roleName1, roleName2],
        })

        const actualRoles = await queryCurrentRoles()
        expect(actualRoles.length).toBe(2)
        expect(actualRoles).toContain(roleName1)
        expect(actualRoles).toContain(roleName2)
      },
    )

    whenOnEnv(TestEnv.LocalSingleNode).it(
      'should use single role from the query options',
      async () => {
        client = createTestClient({
          username,
          password,
          role: [roleName1, roleName2],
        })

        const actualRoles = await queryCurrentRoles(roleName2)
        expect(actualRoles).toEqual([roleName2])
      },
    )

    whenOnEnv(TestEnv.LocalSingleNode).it(
      'should use multiple roles from the query options',
      async () => {
        client = createTestClient({
          username,
          password,
        })

        const actualRoles = await queryCurrentRoles([roleName1, roleName2])
        expect(actualRoles.length).toBe(2)
        expect(actualRoles).toContain(roleName1)
        expect(actualRoles).toContain(roleName2)
      },
    )
  })

  describe('for inserts', () => {
    let tableName: string

    beforeEach(async () => {
      tableName = `insert_test_${guid()}`
      await createSimpleTable(defaultClient, tableName)
    })

    async function tryInsert(role?: string | Array<string>) {
      await client.insert({
        table: tableName,
        values: jsonValues,
        format: 'JSONEachRow',
        role,
      })
    }

    whenOnEnv(TestEnv.LocalSingleNode).it(
      'should successfully insert when client specifies a role that is allowed to insert',
      async () => {
        client = createTestClient({
          username,
          password,
          role: roleName1,
        })

        await tryInsert()
        await assertJsonValues(defaultClient, tableName)
      },
    )

    whenOnEnv(TestEnv.LocalSingleNode).it(
      'should successfully insert when client specifies multiple roles and at least one is allowed to insert',
      async () => {
        client = createTestClient({
          username,
          password,
          role: [roleName1, roleName2],
        })

        await tryInsert()
        await assertJsonValues(defaultClient, tableName)
      },
    )

    whenOnEnv(TestEnv.LocalSingleNode).it(
      'should fail to insert when client specifies a role that is not allowed to insert',
      async () => {
        client = createTestClient({
          username,
          password,
          role: roleName2,
        })

        await expectAsync(tryInsert()).toBeRejectedWith(
          jasmine.objectContaining({
            message: jasmine.stringContaining('Not enough privileges'),
            code: '497',
            type: 'ACCESS_DENIED',
          }),
        )
      },
    )

    whenOnEnv(TestEnv.LocalSingleNode).it(
      'should successfully insert when insert specifies a role that is allowed to insert',
      async () => {
        client = createTestClient({
          username,
          password,
          role: roleName2,
        })

        await tryInsert(roleName1)
        await assertJsonValues(defaultClient, tableName)
      },
    )

    whenOnEnv(TestEnv.LocalSingleNode).it(
      'should successfully insert when insert specifies multiple roles and at least one is allowed to insert',
      async () => {
        client = createTestClient({
          username,
          password,
          role: roleName2,
        })

        await tryInsert([roleName1, roleName2])
        await assertJsonValues(defaultClient, tableName)
      },
    )

    whenOnEnv(TestEnv.LocalSingleNode).it(
      'should fail to insert when insert specifies a role that is not allowed to insert',
      async () => {
        client = createTestClient({
          username,
          password,
          role: roleName1,
        })

        await expectAsync(tryInsert(roleName2)).toBeRejectedWith(
          jasmine.objectContaining({
            message: jasmine.stringContaining('Not enough privileges'),
            code: '497',
            type: 'ACCESS_DENIED',
          }),
        )
      },
    )
  })

  describe('for commands', () => {
    let tableName: string

    beforeEach(async () => {
      tableName = `command_role_test_${guid()}`
    })

    async function tryCreateTable(role?: string | Array<string>) {
      const query = `
        CREATE TABLE ${tableName}
        (id UInt64, name String, sku Array(UInt8), timestamp DateTime)
        ENGINE = MergeTree()
        ORDER BY (id)
      `
      await client.command({ query, role })
    }

    async function checkCreatedTable(tableName: string) {
      const selectResult = await defaultClient.query({
        query: `SELECT * from system.tables where name = '${tableName}'`,
        format: 'JSON',
      })

      const { data, rows } = await selectResult.json<{ name: string }>()
      expect(rows).toBe(1)
      expect(data[0].name).toBe(tableName)
    }

    whenOnEnv(TestEnv.LocalSingleNode).it(
      'should successfully create a table when client specifies a role that is allowed to create tables',
      async () => {
        client = createTestClient({
          username,
          password,
          role: roleName1,
        })

        await tryCreateTable()
        await checkCreatedTable(tableName)
      },
    )

    whenOnEnv(TestEnv.LocalSingleNode).it(
      'should successfully create table when client specifies multiple roles and at least one is allowed to create tables',
      async () => {
        client = createTestClient({
          username,
          password,
          role: [roleName1, roleName2],
        })

        await tryCreateTable()
        await checkCreatedTable(tableName)
      },
    )

    whenOnEnv(TestEnv.LocalSingleNode).it(
      'should fail to create a table when client specifies a role that is not allowed to create tables',
      async () => {
        client = createTestClient({
          username,
          password,
          role: roleName2,
        })

        await expectAsync(tryCreateTable()).toBeRejectedWith(
          jasmine.objectContaining({
            message: jasmine.stringContaining('Not enough privileges'),
            code: '497',
            type: 'ACCESS_DENIED',
          }),
        )
      },
    )

    whenOnEnv(TestEnv.LocalSingleNode).it(
      'should successfully create table when command specifies a role that is allowed to create tables',
      async () => {
        client = createTestClient({
          username,
          password,
          role: roleName2,
        })

        await tryCreateTable(roleName1)
        await checkCreatedTable(tableName)
      },
    )

    whenOnEnv(TestEnv.LocalSingleNode).it(
      'should successfully create table when command specifies multiple roles and at least one is allowed to create tables',
      async () => {
        client = createTestClient({
          username,
          password,
          role: roleName2,
        })

        await tryCreateTable([roleName1, roleName2])
        await checkCreatedTable(tableName)
      },
    )

    whenOnEnv(TestEnv.LocalSingleNode).it(
      'should fail to create table when command specifies a role that is not allowed to create tables',
      async () => {
        client = createTestClient({
          username,
          password,
          role: roleName1,
        })

        await expectAsync(tryCreateTable(roleName2)).toBeRejectedWith(
          jasmine.objectContaining({
            message: jasmine.stringContaining('Not enough privileges'),
            code: '497',
            type: 'ACCESS_DENIED',
          }),
        )
      },
    )
  })
})
