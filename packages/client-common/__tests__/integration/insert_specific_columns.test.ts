import { type ClickHouseClient } from '@clickhouse/client-common'
import { createTableWithFields } from '@test/fixtures/table_with_fields'
import { createTestClient } from '../utils'

describe('Insert with specific columns', () => {
  let client: ClickHouseClient
  let table: string

  beforeEach(async () => {
    client = createTestClient({
      clickhouse_settings: {
        allow_experimental_object_type: 1,
      },
    })
  })
  afterEach(async () => {
    await client.close()
  })

  // Inspired by https://github.com/ClickHouse/clickhouse-js/issues/217
  // Specifying a particular insert column is especially useful with ephemeral types
  describe('list of columns', () => {
    beforeEach(async () => {
      // `message_raw` will be used as a source for default values here
      table = await createTableWithFields(
        client,
        `
        event_type  LowCardinality(String) DEFAULT JSONExtractString(message_raw, 'type'),
        repo_name   LowCardinality(String) DEFAULT JSONExtractString(message_raw, 'repo', 'name'),
        message     JSON                   DEFAULT message_raw,
        message_raw String                 EPHEMERAL
      ` // `id UInt32` will be added as well
      )
    })

    it('should work with a single column', async () => {
      await client.insert({
        table,
        values: [
          {
            message_raw: {
              type: 'MyEventType',
              repo: {
                name: 'foo',
              },
            },
          },
          {
            message_raw: {
              type: 'SomeOtherType',
              repo: {
                name: 'bar',
              },
            },
          },
        ],
        format: 'JSONEachRow',
        columns: ['message_raw'],
      })

      const result = await client
        .query({
          query: `SELECT * FROM ${table} ORDER BY repo_name DESC`,
          format: 'JSONEachRow',
        })
        .then((r) => r.json())

      expect(result).toEqual([
        {
          id: 0, // defaults for everything are taken from `message_raw`
          event_type: 'MyEventType',
          repo_name: 'foo',
          message: {
            type: 'MyEventType',
            repo: {
              name: 'foo',
            },
          },
        },
        {
          id: 0,
          event_type: 'SomeOtherType',
          repo_name: 'bar',
          message: {
            type: 'SomeOtherType',
            repo: {
              name: 'bar',
            },
          },
        },
      ])
    })

    it('should work with multiple columns', async () => {
      await client.insert({
        table,
        values: [
          {
            id: 42,
            message_raw: {
              type: 'MyEventType',
              repo: {
                name: 'foo',
              },
            },
          },
          {
            id: 144,
            message_raw: {
              type: 'SomeOtherType',
              repo: {
                name: 'bar',
              },
            },
          },
        ],
        format: 'JSONEachRow',
        columns: ['id', 'message_raw'],
      })

      const result = await client
        .query({
          query: `SELECT * FROM ${table} ORDER BY id`,
          format: 'JSONEachRow',
        })
        .then((r) => r.json())

      expect(result).toEqual([
        {
          id: 42, // all defaults except `id` are taken from `message_raw`
          event_type: 'MyEventType',
          repo_name: 'foo',
          message: {
            type: 'MyEventType',
            repo: {
              name: 'foo',
            },
          },
        },
        {
          id: 144,
          event_type: 'SomeOtherType',
          repo_name: 'bar',
          message: {
            type: 'SomeOtherType',
            repo: {
              name: 'bar',
            },
          },
        },
      ])
    })

    // In this case, `message_raw` will be ignored, as expected
    it('should work when all the columns are specified', async () => {
      const value1 = {
        id: 42,
        event_type: 'MyEventType',
        repo_name: 'foo',
        message: { foo: 'bar' },
      }
      const value2 = {
        id: 42,
        event_type: 'MyEventType',
        repo_name: 'foo',
        message: { foo: 'bar' },
      }
      await client.insert({
        table,
        values: [
          { ...value1, message_raw: '{ "i": 42 }' },
          { ...value2, message_raw: '{ "j": 255 }' },
        ],
        format: 'JSONEachRow',
        columns: ['id', 'event_type', 'repo_name', 'message', 'message_raw'],
      })

      const result = await client
        .query({
          query: `SELECT * FROM ${table} ORDER BY id`,
          format: 'JSONEachRow',
        })
        .then((r) => r.json())

      expect(result).toEqual([value1, value2])
    })

    it('should fail when an unknown column is specified', async () => {
      await expectAsync(
        client.insert({
          table,
          values: [
            {
              message_raw: {
                type: 'MyEventType',
                repo: {
                  name: 'foo',
                },
              },
            },
            {
              message_raw: {
                type: 'SomeOtherType',
                repo: {
                  name: 'bar',
                },
              },
            },
          ],
          format: 'JSONEachRow',
          columns: ['foobar', 'message_raw'],
        })
      ).toBeRejectedWith(
        jasmine.objectContaining({
          message: jasmine.stringContaining('No such column foobar'),
        })
      )
    })
  })

  // This is impossible to test with ephemeral columns (need to send at least `message_raw`),
  // so for this corner case the tests are simplified. Essentially, just a fallback to the "normal" insert behavior.
  describe('list of columns corner cases', () => {
    beforeEach(async () => {
      table = await createTableWithFields(
        client,
        `s String, b Boolean` // `id UInt32` will be added as well
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
        columns: [] as unknown as [string, ...string[]],
      })

      const result = await client
        .query({
          query: `SELECT * FROM ${table} ORDER BY id`,
          format: 'JSONEachRow',
        })
        .then((r) => r.json())

      expect(result).toEqual(values)
    })
  })

  // TODO: For some reason, ephemeral columns don't work well with EXCEPT (even from the CLI) - to be investigated.
  //  Thus, the tests for this case are simplified.
  describe('list of excluded columns', () => {
    beforeEach(async () => {
      table = await createTableWithFields(
        client,
        `s String, b Boolean` // `id UInt32` will be added as well
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
          query: `SELECT * FROM ${table} ORDER BY id`,
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
          query: `SELECT * FROM ${table} ORDER BY s DESC`,
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
          except: [] as unknown as [string, ...string[]],
        },
      })

      const result = await client
        .query({
          query: `SELECT * FROM ${table}`,
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
          query: `SELECT * FROM ${table}`,
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
          query: `SELECT * FROM ${table}`,
          format: 'JSONEachRow',
        })
        .then((r) => r.json())

      expect(result).toEqual(values)
    })
  })
})
