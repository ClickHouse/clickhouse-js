import { describe, expect, it, vi } from 'vitest'
import {
  ClickHouseDatabase,
  clickhouseTable,
  ident,
  int32,
  int64,
  mergeTree,
  sql,
  string,
  UnsupportedFeatureError,
} from '../../src/index.js'

const users = clickhouseTable(
  'users',
  {
    id: int64(),
    name: string(),
    age: int32(),
  },
  () => ({ engine: mergeTree(), orderBy: ['id'] }),
)

function fakeClient() {
  const jsonResult: unknown = [{ id: '1', name: 'Ada', age: 36 }]
  return {
    query: vi.fn(async () => ({
      json: vi.fn(async () => jsonResult),
    })),
    command: vi.fn(async () => undefined),
    insert: vi.fn(async () => undefined),
  }
}

describe('SelectBuilder → SQL', () => {
  it('emits SELECT *, FROM, WHERE, ORDER BY, LIMIT, OFFSET, SETTINGS', () => {
    const db = new ClickHouseDatabase(fakeClient())
    const q = db
      .select()
      .from(users)
      .where(sql`${ident('age')} > ${18}`)
      .orderBy({ expr: 'id', direction: 'DESC' })
      .limit(10)
      .offset(20)
      .settings({ max_threads: 4 })
    const { sql: text } = q.toSQL()
    expect(text).toContain('SELECT *')
    expect(text).toContain('FROM `users`')
    expect(text).toContain('WHERE `age` > 18')
    expect(text).toContain('ORDER BY `id` DESC')
    expect(text).toContain('LIMIT 10 OFFSET 20')
    expect(text).toContain('SETTINGS max_threads = 4')
  })

  it('supports FINAL and WITH clauses', () => {
    const db = new ClickHouseDatabase(fakeClient())
    const q = db
      .select()
      .with({ name: 'recent', query: sql`SELECT * FROM ${ident('users')} LIMIT 100` })
      .from(users)
      .final()
    const { sql: text } = q.toSQL()
    expect(text).toContain('WITH `recent` AS (SELECT * FROM `users` LIMIT 100)')
    expect(text).toContain('FROM `users` FINAL')
  })

  it('rejects negative limit/offset', () => {
    const db = new ClickHouseDatabase(fakeClient())
    expect(() => db.select().limit(-1)).toThrow()
    expect(() => db.select().offset(-1)).toThrow()
  })
})

describe('ClickHouseDatabase execution', () => {
  it('runs a SELECT through client.query() with JSONEachRow and returns rows', async () => {
    const client = fakeClient()
    const db = new ClickHouseDatabase(client)
    const rows = await db.run(db.select().from(users).limit(1))
    expect(rows).toEqual([{ id: '1', name: 'Ada', age: 36 }])
    expect(client.query).toHaveBeenCalledTimes(1)
    const call = client.query.mock.calls[0]![0]
    expect(call.format).toBe('JSONEachRow')
    expect(call.query).toContain('FROM `users`')
  })

  it('runs an INSERT through native client.insert() with JSONEachRow', async () => {
    const client = fakeClient()
    const db = new ClickHouseDatabase(client)
    await db.runInsert(db.insert(users).values([{ id: '1', name: 'Ada', age: 36 }]))
    expect(client.insert).toHaveBeenCalledTimes(1)
    const call = client.insert.mock.calls[0]![0]
    expect(call.table).toBe('users')
    expect(call.format).toBe('JSONEachRow')
    expect(call.values).toEqual([{ id: '1', name: 'Ada', age: 36 }])
  })

  it('skips empty INSERT', async () => {
    const client = fakeClient()
    const db = new ClickHouseDatabase(client)
    await db.runInsert(db.insert(users).values([]))
    expect(client.insert).not.toHaveBeenCalled()
  })

  it('routes createTable/dropTable/truncateTable through client.command()', async () => {
    const client = fakeClient()
    const db = new ClickHouseDatabase(client)
    await db.createTable(users, { ifNotExists: true })
    await db.dropTable(users, { ifExists: true })
    await db.truncateTable(users, { ifExists: true })
    expect(client.command).toHaveBeenCalledTimes(3)
    expect(client.command.mock.calls[0]![0].query).toContain(
      'CREATE TABLE IF NOT EXISTS `users`',
    )
    expect(client.command.mock.calls[1]![0].query).toContain('DROP TABLE IF EXISTS `users`')
    expect(client.command.mock.calls[2]![0].query).toContain(
      'TRUNCATE TABLE IF EXISTS `users`',
    )
  })

  it('uses the configured default database for qualified names', async () => {
    const client = fakeClient()
    const db = new ClickHouseDatabase(client, { database: 'analytics' })
    await db.createTable(users)
    expect(client.command.mock.calls[0]![0].query).toContain(
      'CREATE TABLE `analytics`.`users`',
    )
  })

  it('throws UnsupportedFeatureError on transaction() unless allowNoTx', async () => {
    const db = new ClickHouseDatabase(fakeClient())
    await expect(db.transaction(async () => 1)).rejects.toBeInstanceOf(
      UnsupportedFeatureError,
    )
    await expect(db.transaction(async () => 7, { allowNoTx: true })).resolves.toBe(7)
  })

  it('passes through defaultSettings on every command/query/insert', async () => {
    const client = fakeClient()
    const db = new ClickHouseDatabase(client, {
      defaultSettings: { async_insert: 1 },
    })
    await db.run(db.select().from(users).limit(1))
    await db.runInsert(db.insert(users).values([{ id: '1', name: 'X', age: 1 }]))
    await db.createTable(users)
    expect(client.query.mock.calls[0]![0].clickhouse_settings).toEqual({
      async_insert: 1,
    })
    expect(client.insert.mock.calls[0]![0].clickhouse_settings).toEqual({
      async_insert: 1,
    })
    expect(client.command.mock.calls[0]![0].clickhouse_settings).toEqual({
      async_insert: 1,
    })
  })
})
