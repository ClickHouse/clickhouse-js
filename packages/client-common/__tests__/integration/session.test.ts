import type { ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient, guid, TestEnv, whenOnEnv } from '@test/utils'

describe('sessions settings', () => {
  let client: ClickHouseClient
  afterEach(async () => {
    await client.close()
  })

  whenOnEnv(TestEnv.LocalSingleNode).it('should use sessions', async () => {
    client = createTestClient({
      session_id: `test-session-${guid()}`,
    })

    const tableName = `temp_table_${guid()}`
    await client.command({
      query: getTempTableDDL(tableName),
    })
    await client.insert({
      table: tableName,
      values: [{ id: 42, name: 'foo' }],
      format: 'JSONEachRow',
    })
    await client.exec({
      query: `INSERT INTO ${tableName} VALUES (43, 'bar')`,
    })
    const rs = await client.query({
      query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
      format: 'JSONEachRow',
    })
    expect(await rs.json()).toEqual([
      { id: 42, name: 'foo' },
      { id: 43, name: 'bar' },
    ])
  })

  whenOnEnv(TestEnv.LocalSingleNode).it(
    'should use session override',
    async () => {
      // no session_id by default
      client = createTestClient()

      const sessionId = `test-session-${guid()}`
      const tableName = `temp_table_${guid()}`
      await client.command({
        query: getTempTableDDL(tableName),
        session_id: sessionId,
      })
      await client.insert({
        table: tableName,
        values: [{ id: 144, name: 'qaz' }],
        format: 'JSONEachRow',
        session_id: sessionId,
      })
      await client.exec({
        query: `INSERT INTO ${tableName} VALUES (255, 'qux')`,
        session_id: sessionId,
      })
      const rs = await client.query({
        query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
        format: 'JSONEachRow',
        session_id: sessionId,
      })
      expect(await rs.json()).toEqual([
        { id: 144, name: 'qaz' },
        { id: 255, name: 'qux' },
      ])
    },
  )

  function getTempTableDDL(tableName: string) {
    return `
      CREATE TEMPORARY TABLE ${tableName}
      (id Int32, name String)
    `
  }
})
