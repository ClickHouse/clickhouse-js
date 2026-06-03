import { describe, expect, it } from 'vitest'
import {
  array,
  ClickHouseDialect,
  clickhouseTable,
  dateTime64,
  decimal,
  enum8,
  fixedString,
  ident,
  int32,
  int64,
  json as jsonCol,
  lowCardinality,
  mergeTree,
  replacingMergeTree,
  sql,
  string,
  uint8,
  uuid,
} from '../../src/index.js'

describe('escape & quoting', () => {
  const d = new ClickHouseDialect()

  it('quotes identifiers with backticks and escapes embedded backticks', () => {
    const t = clickhouseTable(
      'we`ird',
      { id: int32(), col: string() },
      () => ({ engine: mergeTree(), orderBy: ['id'] }),
    )
    const ddl = d.createTable(t).sql
    expect(ddl).toContain('`we\\`ird`')
    expect(ddl).toContain('`id` Int32')
  })

  it('escapes string literals in DEFAULT clauses', () => {
    const t = clickhouseTable(
      'defaults',
      { greeting: string().default("hi 'world'\n") },
      () => ({ engine: mergeTree(), orderBy: [] }),
    )
    expect(d.createTable(t).sql).toContain(
      "`greeting` String DEFAULT 'hi \\'world\\'\\n'",
    )
  })
})

describe('column DDL', () => {
  const d = new ClickHouseDialect()

  it('builds Nullable + LowCardinality wrappers in the right order', () => {
    const t = clickhouseTable(
      't',
      { c: lowCardinality(string().nullable()) },
      () => ({ engine: mergeTree(), orderBy: [] }),
    )
    expect(d.createTable(t).sql).toContain(
      '`c` LowCardinality(Nullable(String))',
    )
  })

  it('builds Decimal/FixedString/DateTime64/Enum/Array/UUID/JSON/UInt8/Int64', () => {
    const t = clickhouseTable(
      't',
      {
        price: decimal(18, 4),
        code: fixedString(8),
        ts: dateTime64(6, 'UTC'),
        kind: enum8({ a: 1, b: 2 }),
        tags: array(string()),
        id: uuid(),
        payload: jsonCol(),
        flag: uint8(),
        big: int64(),
      },
      () => ({ engine: mergeTree(), orderBy: ['ts'] }),
    )
    const sqlText = d.createTable(t).sql
    expect(sqlText).toContain('`price` Decimal(18, 4)')
    expect(sqlText).toContain('`code` FixedString(8)')
    expect(sqlText).toContain("`ts` DateTime64(6, 'UTC')")
    expect(sqlText).toContain("`kind` Enum8('a' = 1, 'b' = 2)")
    expect(sqlText).toContain('`tags` Array(String)')
    expect(sqlText).toContain('`id` UUID')
    expect(sqlText).toContain('`payload` JSON')
    expect(sqlText).toContain('`flag` UInt8')
    expect(sqlText).toContain('`big` Int64')
  })

  it('rejects invalid decimal arguments', () => {
    expect(() => decimal(0, 0)).toThrow()
    expect(() => decimal(5, 6)).toThrow()
    expect(() => decimal(5, -1)).toThrow()
  })

  it('rejects invalid fixedString / dateTime64 arguments', () => {
    expect(() => fixedString(0)).toThrow()
    expect(() => dateTime64(-1)).toThrow()
    expect(() => dateTime64(10)).toThrow()
  })

  it('rejects empty enums', () => {
    expect(() => enum8({})).toThrow()
  })
})

describe('CREATE / DROP / TRUNCATE TABLE', () => {
  const d = new ClickHouseDialect({ database: 'analytics' })

  it('renders engine, orderBy, partitionBy, settings, ttl, comment, cluster', () => {
    const t = clickhouseTable(
      'events',
      {
        ts: dateTime64(3),
        user_id: int64(),
        kind: string(),
      },
      () => ({
        engine: replacingMergeTree('ts'),
        orderBy: ['user_id', 'ts'],
        partitionBy: sql`toYYYYMM(${ident('ts')})`,
        primaryKey: ['user_id'],
        settings: { index_granularity: 8192, allow_nullable_key: true },
        ttl: sql`${ident('ts')} + INTERVAL 30 DAY`,
        comment: "it's events",
        cluster: 'main',
      }),
    )
    const out = d.createTable(t, { ifNotExists: true }).sql
    expect(out).toContain('CREATE TABLE IF NOT EXISTS `analytics`.`events`')
    expect(out).toContain('ON CLUSTER `main`')
    expect(out).toContain('ENGINE = ReplacingMergeTree(ts)')
    expect(out).toContain('ORDER BY `user_id`, `ts`')
    expect(out).toContain('PARTITION BY toYYYYMM(`ts`)')
    expect(out).toContain('PRIMARY KEY (`user_id`)')
    expect(out).toContain('TTL `ts` + INTERVAL 30 DAY')
    expect(out).toContain(
      'SETTINGS index_granularity = 8192, allow_nullable_key = 1',
    )
    expect(out).toContain("COMMENT 'it\\'s events'")
  })

  it('emits ORDER BY tuple() when orderBy is empty', () => {
    const t = clickhouseTable('noop', { x: int32() }, () => ({
      engine: mergeTree(),
      orderBy: [],
    }))
    expect(d.createTable(t).sql).toContain('ORDER BY tuple()')
  })

  it('drops/truncates with IF EXISTS / SYNC / ON CLUSTER', () => {
    const t = clickhouseTable('x', { a: int32() }, () => ({
      engine: mergeTree(),
      orderBy: [],
      cluster: 'c1',
    }))
    expect(d.dropTable(t, { ifExists: true, sync: true }).sql).toBe(
      'DROP TABLE IF EXISTS `analytics`.`x` ON CLUSTER `c1` SYNC',
    )
    expect(d.truncateTable(t).sql).toBe(
      'TRUNCATE TABLE `analytics`.`x` ON CLUSTER `c1`',
    )
  })
})
