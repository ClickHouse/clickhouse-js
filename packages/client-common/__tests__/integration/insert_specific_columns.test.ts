import { type ClickHouseClient } from '@clickhouse/client-common'
import { createTableWithFields } from '@test/fixtures/table_with_fields'
import { createTestClient, guid } from '../utils'
import { createSimpleTable } from '../fixtures/simple_table'

describe('Insert with specific columns', () => {
  let client: ClickHouseClient
  let table: string

  beforeEach(async () => {
    client = createTestClient()
  })
  afterEach(async () => {
    await client.close()
  })

  describe('list of columns', () => {
    beforeEach(async () => {
      table = `insert_specific_columns_${guid()}`
      await createSimpleTable(client, table)
    })

    const row = {
      id: '42',
      name: 'foo',
      sku: [144],
    }

    it('should work with a single column', async () => {
      await client.insert({
        table,
        values: [{ id: 42 }],
        format: 'JSONEachRow',
        columns: ['id'],
      })
      const result = await select()
      expect(result).toEqual([
        {
          id: '42',
          name: '',
          sku: [],
        },
      ])
    })

    it('should work with multiple columns', async () => {
      await client.insert({
        table,
        values: [
          {
            id: '42',
            name: 'foo',
          },
        ],
        format: 'JSONEachRow',
        columns: ['id', 'name'],
      })
      const result = await select()
      expect(result).toEqual([
        {
          id: '42',
          name: 'foo',
          sku: [],
        },
      ])
    })

    it('should work when all the columns are specified', async () => {
      await client.insert({
        table,
        values: [row],
        format: 'JSONEachRow',
        columns: ['id', 'name', 'sku'],
      })
      const result = await select()
      expect(result).toEqual([row])
    })

    it('should fail when an unknown column is specified', async () => {
      await expectAsync(
        client.insert({
          table,
          values: [row],
          format: 'JSONEachRow',
          columns: ['foobar', 'id'],
        }),
      ).toBeRejectedWith(
        jasmine.objectContaining({
          message: jasmine.stringContaining('No such column foobar'),
        }),
      )
    })
  })

  describe('list of columns corner cases', () => {
    beforeEach(async () => {
      table = await createTableWithFields(
        client,
        `s String, b Boolean`, // `id UInt32` will be added as well
      )
    })

    it('should work when the list is empty', async () => {
      const values = [
        { id: 144, s: 'foo', b: true },
        { id: 255, s: 'bar', b: false },
      ]

      await client.insert({
        table,
        values,
        format: 'JSONEachRow',
        // Prohibited by the type system, but the client can be used from the JS
        columns: [] as unknown as [string, ...Array<string>],
      })

      const result = await client
        .query({
          query: `SELECT *
                  FROM ${table}
                  ORDER BY id`,
          format: 'JSONEachRow',
        })
        .then((r) => r.json())

      expect(result).toEqual(values)
    })
  })

  describe('list of excluded columns', () => {
    beforeEach(async () => {
      table = await createTableWithFields(
        client,
        `s String, b Boolean`, // `id UInt32` will be added as well
      )
    })

    it('should work with a single excluded column', async () => {
      await client.insert({
        table,
        values: [
          { id: 144, b: true },
          { id: 255, b: false },
        ],
        format: 'JSONEachRow',
        columns: {
          except: ['s'],
        },
      })

      const result = await client
        .query({
          query: `SELECT *
                  FROM ${table}
                  ORDER BY id`,
          format: 'JSONEachRow',
        })
        .then((r) => r.json())

      expect(result).toEqual([
        { id: 144, s: '', b: true },
        { id: 255, s: '', b: false },
      ])
    })

    it('should work with multiple excluded columns', async () => {
      await client.insert({
        table,
        values: [{ s: 'foo' }, { s: 'bar' }],
        format: 'JSONEachRow',
        columns: {
          except: ['id', 'b'],
        },
      })

      const result = await client
        .query({
          query: `SELECT *
                  FROM ${table}
                  ORDER BY s DESC`,
          format: 'JSONEachRow',
        })
        .then((r) => r.json())

      expect(result).toEqual([
        { id: 0, s: 'foo', b: false },
        { id: 0, s: 'bar', b: false },
      ])
    })

    it('should work when the list is empty', async () => {
      const values = [
        { id: 144, s: 'foo', b: true },
        { id: 255, s: 'bar', b: false },
      ]
      await client.insert({
        table,
        values,
        format: 'JSONEachRow',
        columns: {
          // Prohibited by the type system, but the client can be used from the JS
          except: [] as unknown as [string, ...Array<string>],
        },
      })

      const result = await client
        .query({
          query: `SELECT *
                  FROM ${table}`,
          format: 'JSONEachRow',
        })
        .then((r) => r.json())

      expect(result).toEqual(values)
    })

    it('should work when all the columns are excluded', async () => {
      await client.insert({
        table,
        values: [{}, {}],
        format: 'JSONEachRow',
        columns: {
          except: ['id', 's', 'b'],
        },
      })

      const result = await client
        .query({
          query: `SELECT *
                  FROM ${table}`,
          format: 'JSONEachRow',
        })
        .then((r) => r.json())

      // While ClickHouse allows that via HTTP, the data won't be actually inserted
      expect(result).toEqual([])
    })

    // Surprisingly, `EXCEPT some_unknown_column` does not fail, even from the CLI
    it('should still work when an unknown column is specified', async () => {
      const values = [
        { id: 144, s: 'foo', b: true },
        { id: 255, s: 'bar', b: false },
      ]

      await client.insert({
        table,
        values,
        format: 'JSONEachRow',
        columns: {
          except: ['foobar'],
        },
      })

      const result = await client
        .query({
          query: `SELECT *
                  FROM ${table}`,
          format: 'JSONEachRow',
        })
        .then((r) => r.json())

      expect(result).toEqual(values)
    })
  })

  async function select() {
    const rs = await client.query({
      query: `SELECT *
              FROM ${table}
              ORDER BY id ASC`,
      format: 'JSONEachRow',
    })
    return rs.json<{ id: string; name: string; sku: Array<number> }>()
  }
})
