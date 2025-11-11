import { type ClickHouseClient } from '@clickhouse/client-common'
import { createSimpleTable } from '@test/fixtures/simple_table'
import { assertJsonValues, jsonValues } from '@test/fixtures/test_data'
import { createTestClient, guid } from '@test/utils'
import { requireServerVersionAtLeast } from '@test/utils/jasmine'
import Stream from 'stream'
import { makeObjectStream } from '../utils/stream'

describe('[Node.js] stream JSON formats', () => {
  let client: ClickHouseClient
  let tableName: string

  beforeEach(async () => {
    client = createTestClient()
    tableName = `insert_stream_json_${guid()}`
    await createSimpleTable(client, tableName)
  })
  afterEach(async () => {
    await client.close()
  })

  it('should work with JSONEachRow', async () => {
    const stream = makeObjectStream()
    jsonValues.forEach((value) => stream.push(value))
    setTimeout(() => stream.push(null), 100)
    await client.insert({
      table: tableName,
      values: stream,
      format: 'JSONEachRow',
    })
    await assertJsonValues(client, tableName)
  })

  it('should work with JSONStringsEachRow', async () => {
    const stream = makeObjectStream()
    stream.push({ id: '42', name: 'foo', sku: '[0,1]' })
    stream.push({ id: '43', name: 'bar', sku: '[0,1,2]' })
    setTimeout(() => stream.push(null), 100)
    await client.insert({
      table: tableName,
      values: stream,
      format: 'JSONStringsEachRow',
    })
    const result = await client.query({
      query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
      format: 'JSONStringsEachRow',
    })
    expect(await result.json()).toEqual([
      { id: '42', name: 'foo', sku: '[0,1]' },
      { id: '43', name: 'bar', sku: '[0,1,2]' },
    ])
  })

  describe('JSONCompactEachRow', () => {
    it('should work with JSONCompactEachRow', async () => {
      const stream = makeObjectStream()
      stream.push(['42', 'foo', [0, 1]])
      stream.push(['43', 'bar', [2, 3]])
      setTimeout(() => stream.push(null), 100)
      await client.insert({
        table: tableName,
        values: stream,
        format: 'JSONCompactEachRow',
      })
      const result = await client.query({
        query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
        format: 'JSONCompactEachRow',
      })
      expect(await result.json()).toEqual([
        ['42', 'foo', [0, 1]],
        ['43', 'bar', [2, 3]],
      ])
    })

    it('should work with JSONCompactStringsEachRow', async () => {
      const stream = makeObjectStream()
      stream.push(['42', 'foo', '[0,1]'])
      stream.push(['43', 'bar', '[2,3]'])
      setTimeout(() => stream.push(null), 100)
      await client.insert({
        table: tableName,
        values: stream,
        format: 'JSONCompactStringsEachRow',
      })
      const result = await client.query({
        query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
        format: 'JSONCompactStringsEachRow',
      })
      expect(await result.json()).toEqual([
        ['42', 'foo', '[0,1]'],
        ['43', 'bar', '[2,3]'],
      ])
    })

    it('should work with JSONCompactEachRowWithNames', async () => {
      const stream = makeObjectStream()
      stream.push(['id', 'name', 'sku'])
      stream.push(['42', 'foo', [0, 1]])
      stream.push(['43', 'bar', [2, 3]])
      setTimeout(() => stream.push(null), 100)
      await client.insert({
        table: tableName,
        values: stream,
        format: 'JSONCompactEachRowWithNames',
      })
      const result = await client.query({
        query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
        format: 'JSONCompactEachRowWithNames',
      })
      expect(await result.json()).toEqual([
        ['id', 'name', 'sku'],
        ['42', 'foo', [0, 1]],
        ['43', 'bar', [2, 3]],
      ])
    })

    it('should work with JSONCompactEachRowWithNamesAndTypes', async () => {
      const stream = makeObjectStream()
      stream.push(['id', 'name', 'sku'])
      stream.push(['UInt64', 'String', 'Array(UInt8)'])
      stream.push(['42', 'foo', [0, 1]])
      stream.push(['43', 'bar', [2, 3]])
      setTimeout(() => stream.push(null), 100)
      await client.insert({
        table: tableName,
        values: stream,
        format: 'JSONCompactEachRowWithNamesAndTypes',
      })
      const result = await client.query({
        query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
        format: 'JSONCompactEachRowWithNamesAndTypes',
      })
      expect(await result.json()).toEqual([
        ['id', 'name', 'sku'],
        ['UInt64', 'String', 'Array(UInt8)'],
        ['42', 'foo', [0, 1]],
        ['43', 'bar', [2, 3]],
      ])
    })

    it('should insert data with a wrong name in JSONCompactEachRowWithNamesAndTypes', async () => {
      const stream = makeObjectStream()
      stream.push(['foo', 'name', 'sku'])
      stream.push(['UInt64', 'String', 'Array(UInt8)'])
      stream.push(['42', 'foo', [0, 1]])
      stream.push(['43', 'bar', [2, 3]])
      setTimeout(() => stream.push(null), 100)

      await client.insert({
        table: tableName,
        values: stream,
        format: 'JSONCompactEachRowWithNamesAndTypes',
      })
      const result = await client.query({
        query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
        format: 'JSONCompactEachRowWithNamesAndTypes',
      })
      expect(await result.json()).toEqual([
        ['id', 'name', 'sku'],
        ['UInt64', 'String', 'Array(UInt8)'],
        ['0', 'foo', [0, 1]],
        ['0', 'bar', [2, 3]],
      ])
    })

    it('should throw an exception when insert data with a wrong type in JSONCompactEachRowWithNamesAndTypes', async () => {
      const stream = makeObjectStream()
      stream.push(['id', 'name', 'sku'])
      stream.push(['UInt64', 'UInt64', 'Array(UInt8)'])
      stream.push(['42', 'foo', [0, 1]])
      stream.push(['43', 'bar', [2, 3]])
      setTimeout(() => stream.push(null), 100)

      const insertPromise = client.insert({
        table: tableName,
        values: stream,
        format: 'JSONCompactEachRowWithNamesAndTypes',
      })
      await expectAsync(insertPromise).toBeRejectedWith(
        jasmine.objectContaining({
          message: jasmine.stringMatching(
            `Type of 'name' must be String, not UInt64`,
          ),
        }),
      )
    })

    it('should work with JSONCompactStringsEachRowWithNames', async () => {
      const stream = makeObjectStream()
      stream.push(['id', 'name', 'sku'])
      stream.push(['42', 'foo', '[0,1]'])
      stream.push(['43', 'bar', '[2,3]'])
      setTimeout(() => stream.push(null), 100)
      await client.insert({
        table: tableName,
        values: stream,
        format: 'JSONCompactStringsEachRowWithNames',
      })
      const result = await client.query({
        query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
        format: 'JSONCompactStringsEachRowWithNames',
      })
      expect(await result.json()).toEqual([
        ['id', 'name', 'sku'],
        ['42', 'foo', '[0,1]'],
        ['43', 'bar', '[2,3]'],
      ])
    })

    it('should work with JSONCompactStringsEachRowWithNamesAndTypes', async () => {
      const stream = makeObjectStream()
      stream.push(['id', 'name', 'sku'])
      stream.push(['UInt64', 'String', 'Array(UInt8)'])
      stream.push(['42', 'foo', '[0,1]'])
      stream.push(['43', 'bar', '[2,3]'])
      setTimeout(() => stream.push(null), 100)
      await client.insert({
        table: tableName,
        values: stream,
        format: 'JSONCompactStringsEachRowWithNamesAndTypes',
      })
      const result = await client.query({
        query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
        format: 'JSONCompactStringsEachRowWithNamesAndTypes',
      })
      expect(await result.json()).toEqual([
        ['id', 'name', 'sku'],
        ['UInt64', 'String', 'Array(UInt8)'],
        ['42', 'foo', '[0,1]'],
        ['43', 'bar', '[2,3]'],
      ])
    })
  })

  describe('JSONEachRowWithProgress', () => {
    it('works with progress rows', async () => {
      const rs = await client.query({
        query: 'SELECT sleep(0.1) AS foo FROM numbers(2)',
        format: 'JSONEachRowWithProgress',
        clickhouse_settings: {
          // triggers more progress rows, as it is emitted after each block
          max_block_size: '1',
        },
      })
      const rows = await rs.json()
      console.dir(rows, {
        depth: null,
      })
      expect(rows).toEqual([
        {
          progress: {
            read_rows: '1',
            read_bytes: '8',
            total_rows_to_read: '2',
            elapsed_ns: jasmine.stringMatching(/^\d+$/),
          },
        },
        { meta: [{ name: 'foo', type: 'UInt8' }] },
        { row: { foo: 0 } },
        {
          progress: {
            read_rows: '2',
            read_bytes: '16',
            total_rows_to_read: '2',
            elapsed_ns: jasmine.stringMatching(/^\d+$/),
          },
        },
        { row: { foo: 0 } },
      ])
    })

    // See https://github.com/ClickHouse/ClickHouse/pull/74181/files#diff-9be59e5a502cccf360c8f2b0419115cfa2513def8f964f7c24459cfa0e877578
    it('works with special events', async () => {
      const rs = await client.query({
        query: `SELECT (123 + number * 456) % 100 AS k, count() AS c, sum(number) AS s FROM numbers(100) GROUP BY ALL WITH TOTALS ORDER BY ALL LIMIT 10`,
        format: 'JSONEachRowWithProgress',
        clickhouse_settings: {
          rows_before_aggregation: 1,
          extremes: 1,
        },
      })
      const rows = await rs.json<{ k: number; c: string; s: string }>()
      console.dir(rows, {
        depth: null,
      })
      expect(rows).toEqual([
        {
          progress: {
            read_rows: '100',
            read_bytes: '800',
            total_rows_to_read: '100',
            elapsed_ns: jasmine.stringMatching(/^\d+$/),
          },
        },
        {
          meta: [
            { name: 'k', type: 'UInt8' },
            { name: 'c', type: 'UInt64' },
            { name: 's', type: 'UInt64' },
          ],
        },
        { row: { k: 3, c: '4', s: '170' } },
        { row: { k: 7, c: '4', s: '206' } },
        { row: { k: 11, c: '4', s: '242' } },
        { row: { k: 15, c: '4', s: '178' } },
        { row: { k: 19, c: '4', s: '214' } },
        { row: { k: 23, c: '4', s: '150' } },
        { row: { k: 27, c: '4', s: '186' } },
        { row: { k: 31, c: '4', s: '222' } },
        { row: { k: 35, c: '4', s: '158' } },
        { row: { k: 39, c: '4', s: '194' } },
        { totals: { k: 0, c: '100', s: '4950' } },
        { min: { k: 3, c: '4', s: '150' } },
        { max: { k: 39, c: '4', s: '242' } },
        { rows_before_limit_at_least: 25 },
        { rows_before_aggregation: 100 },
      ])
    })

    it('works with exceptions', async () => {
      requireServerVersionAtLeast(25, 11)

      const rs = await client.query({
        query: `SELECT number, throwIf(number = 3, 'boom') AS foo FROM system.numbers`,
        format: 'JSONEachRowWithProgress',
        clickhouse_settings: {
          max_block_size: '1',
        },
      })
      await expectAsync(rs.json()).toBeRejectedWith(
        jasmine.objectContaining({
          code: '395',
          message: jasmine.stringContaining(
            `boom: while executing 'FUNCTION throwIf`,
          ),
        }),
      )
    })
  })

  it('does not throw if stream closes prematurely', async () => {
    const stream = new Stream.Readable({
      objectMode: true,
      read() {
        this.push(null) // close stream
      },
    })

    await expectAsync(
      client.insert({
        table: tableName,
        values: stream,
      }),
    ).toBeResolved()
  })

  it('waits for stream of values to be closed', async () => {
    let closed = false
    const stream = new Stream.Readable({
      objectMode: true,
      read() {
        setTimeout(() => {
          this.push([42, 'hello', [0, 1]])
          this.push([43, 'world', [3, 4]])
          this.push(null)
          closed = true
        }, 100)
      },
    })

    expect(closed).toBe(false)
    await client.insert({
      table: tableName,
      values: stream,
    })
    expect(closed).toBe(true)
  })

  it('can insert multiple streams at once', async () => {
    const streams: Stream.Readable[] = Array(jsonValues.length)
    const insertStreamPromises = Promise.all(
      jsonValues.map((value, i) => {
        const stream = makeObjectStream()
        streams[i] = stream
        stream.push(value)
        return client.insert({
          values: stream,
          format: 'JSONEachRow',
          table: tableName,
        })
      }),
    )
    setTimeout(() => {
      streams.forEach((stream) => stream.push(null))
    }, 100)
    await insertStreamPromises
    await assertJsonValues(client, tableName)
  })

  it('should throw in case of an invalid format of data', async () => {
    const stream = makeObjectStream()
    stream.push({ id: 'baz', name: 'foo', sku: '[0,1]' })
    stream.push(null)
    await expectAsync(
      client.insert({
        table: tableName,
        values: stream,
        format: 'JSONEachRow',
      }),
    ).toBeRejectedWith(
      jasmine.objectContaining({
        message: jasmine.stringContaining('Cannot parse input'),
      }),
    )
  })
})
