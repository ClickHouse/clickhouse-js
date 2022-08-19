import type { ClickHouseClient } from '../../src'
import { createTableWithSchema, createTestClient, guid } from '../utils'
import * as ch from '../../src/schema'
import { And, Eq, Or } from '../../src/schema'

describe('schema e2e test', () => {
  let client: ClickHouseClient
  let tableName: string

  beforeEach(async () => {
    client = await createTestClient()
    tableName = `schema_e2e_test_${guid()}`
  })
  afterEach(async () => {
    await client.close()
  })

  const shape = {
    id: ch.UUID,
    name: ch.String,
    sku: ch.Array(ch.UInt8),
    active: ch.Bool,
  }
  let table: ch.Table<typeof shape>
  type Value = ch.Infer<typeof shape>

  const value1: Value = {
    id: '8dbb28f7-4da0-4e49-af71-e830aee422eb',
    name: 'foo',
    sku: [1, 2],
    active: true,
  }
  const value2: Value = {
    id: '314f5ac4-fe93-4c39-b26c-0cb079be0767',
    name: 'bar',
    sku: [3, 4],
    active: false,
  }

  beforeEach(async () => {
    table = await createTableWithSchema(
      client,
      new ch.Schema(shape),
      tableName,
      ['id']
    )
  })

  it('should insert and select data using arrays', async () => {
    await table.insert({
      values: [value1, value2],
    })
    const result = await (await table.select()).json()
    expect(result).toEqual([value1, value2])
  })

  it('should insert and select data using streams', async () => {
    const values = new ch.InsertStream<Value>()
    values.add(value1)
    values.add(value2)
    setTimeout(() => values.complete(), 100)

    await table.insert({
      values,
    })

    const result: Value[] = []
    const { asyncGenerator } = await table.select()

    for await (const value of asyncGenerator()) {
      result.push(value)
    }

    expect(result).toEqual([value1, value2])
  })

  // FIXME: find a way to disallow default values
  it.skip('should not swallow generic insert errors using arrays', async () => {
    await expect(
      table.insert({
        values: [{ foobar: 'qaz' } as any],
      })
    ).rejects.toEqual(
      expect.objectContaining({
        error: 'asdfsdaf',
      })
    )
  })

  // FIXME: find a way to disallow default values
  it.skip('should not swallow generic insert errors using streams', async () => {
    const values = new ch.InsertStream<Value>()
    values.add(value1)
    values.add({ foobar: 'qaz' } as any)
    setTimeout(() => values.complete(), 100)

    await table.insert({
      values,
    })
    const result = await (await table.select()).json()
    expect(result).toEqual([value1, value2])
  })

  it('should not swallow generic select errors', async () => {
    await expect(
      table.select({
        order_by: [['non_existing_column' as any, 'ASC']],
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining('Missing columns'),
    })
  })

  it('should use order by / where statements', async () => {
    const value3: Value = {
      id: '7640bde3-cdc5-4d63-a47e-66c6a16629df',
      name: 'qaz',
      sku: [6, 7],
      active: true,
    }
    await table.insert({
      values: [value1, value2, value3],
    })

    expect(
      await table
        .select({
          where: Eq('name', 'bar'),
        })
        .then((r) => r.json())
    ).toEqual([value2])

    expect(
      await table
        .select({
          where: Or(Eq('name', 'foo'), Eq('name', 'qaz')),
          order_by: [['name', 'DESC']],
        })
        .then((r) => r.json())
    ).toEqual([value3, value1])

    expect(
      await table
        .select({
          where: And(Eq('active', true), Eq('name', 'foo')),
        })
        .then((r) => r.json())
    ).toEqual([value1])

    expect(
      await table
        .select({
          where: Eq('sku', [3, 4]),
        })
        .then((r) => r.json())
    ).toEqual([value2])

    expect(
      await table
        .select({
          where: And(Eq('active', true), Eq('name', 'quuux')),
        })
        .then((r) => r.json())
    ).toEqual([])

    expect(
      await table
        .select({
          order_by: [
            ['active', 'DESC'],
            ['name', 'DESC'],
          ],
        })
        .then((r) => r.json())
    ).toEqual([value3, value1, value2])

    expect(
      await table
        .select({
          order_by: [
            ['active', 'DESC'],
            ['name', 'ASC'],
          ],
        })
        .then((r) => r.json())
    ).toEqual([value1, value3, value2])
  })

  it('should be able to select only specific columns', async () => {
    await table.insert({
      values: [value1, value2],
    })

    expect(
      await table
        .select({
          columns: ['id'],
          order_by: [['name', 'ASC']],
        })
        .then((r) => r.json())
    ).toEqual([{ id: value2.id }, { id: value1.id }])

    expect(
      await table
        .select({
          columns: ['id', 'active'],
          order_by: [['name', 'ASC']],
        })
        .then((r) => r.json())
    ).toEqual([
      { id: value2.id, active: value2.active },
      { id: value1.id, active: value1.active },
    ])
  })
})
