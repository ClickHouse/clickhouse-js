import { createTestClient, guid, makeRawStream } from '../utils'
import type { ClickHouseClient, ClickHouseSettings } from '../../src'
import { createSimpleTable } from './fixtures/simple_table'
import Stream from 'stream'
import { assertJsonValues, jsonValues } from './fixtures/test_data'

describe('insert stream (raw formats)', () => {
  let client: ClickHouseClient
  let tableName: string
  let stream: Stream.Readable

  beforeEach(async () => {
    tableName = `insert_stream_raw_${guid()}`
    client = createTestClient()
    await createSimpleTable(client, tableName)
  })
  afterEach(async () => {
    await client.close()
  })

  describe('TSV', () => {
    it('should insert a TSV without names or types', async () => {
      stream = Stream.Readable.from(`42\tfoo\t[1,2]\n43\tbar\t[3,4]\n`, {
        objectMode: false,
      })
      await client.insert({
        table: tableName,
        values: stream,
        format: 'TabSeparated',
      })
      await assertInsertedValues()
    })

    it('should insert a TSV with names', async () => {
      stream = Stream.Readable.from(
        `id\tname\tsku\n42\tfoo\t[1,2]\n43\tbar\t[3,4]\n`,
        {
          objectMode: false,
        }
      )
      await client.insert({
        table: tableName,
        values: stream,
        format: 'TabSeparatedWithNames',
      })
      await assertInsertedValues()
    })

    it('should insert a TSV with names and types', async () => {
      stream = Stream.Readable.from(
        `id\tname\tsku\nUInt64\tString\tArray(UInt8)\n42\tfoo\t[1,2]\n43\tbar\t[3,4]\n`,
        {
          objectMode: false,
        }
      )
      await client.insert({
        table: tableName,
        values: stream,
        format: 'TabSeparatedWithNamesAndTypes',
      })
      await assertInsertedValues()
    })

    it('should insert a TSV (unescaped)', async () => {
      stream = Stream.Readable.from(`42\t\\bfoo\t[1,2]\n43\tba\\tr\t[3,4]\n`, {
        objectMode: false,
      })
      await client.insert({
        table: tableName,
        values: stream,
        format: 'TabSeparatedRaw',
      })
      const result = await client.select({
        query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
        format: 'JSONEachRow',
      })
      expect(await result.json()).toEqual([
        { id: '42', name: '\\bfoo', sku: [1, 2] },
        { id: '43', name: 'ba\\tr', sku: [3, 4] },
      ])
    })

    it('should throw in case of invalid TSV format', async () => {
      stream = Stream.Readable.from(`foobar\t42\n`, {
        objectMode: false,
      })
      await expect(
        client.insert({
          table: tableName,
          values: stream,
          format: 'TabSeparated',
        })
      ).rejects.toEqual(
        expect.objectContaining({
          message: expect.stringContaining('Cannot parse input'),
        })
      )
    })

    it('can insert multiple TSV streams at once', async () => {
      const streams: Stream.Readable[] = Array(jsonValues.length)
      const insertStreamPromises = Promise.all(
        jsonValues.map(({ id, name, sku }, i) => {
          const stream = makeRawStream()
          streams[i] = stream
          stream.push(`${id}\t${name}\t[${sku}]\n`)
          return client.insert({
            values: stream,
            format: 'TabSeparated',
            table: tableName,
          })
        })
      )
      setTimeout(() => {
        streams.forEach((stream) => stream.push(null))
      }, 100)
      await insertStreamPromises
      await assertJsonValues(client, tableName)
    })
  })

  describe('CSV', () => {
    it('should insert a CSV without names or types', async () => {
      stream = Stream.Readable.from(`42,foo,"[1,2]"\n43,bar,"[3,4]"\n`, {
        objectMode: false,
      })
      await client.insert({
        table: tableName,
        values: stream,
        format: 'CSV',
      })
      await assertInsertedValues()
    })

    it('should insert a CSV with names', async () => {
      stream = Stream.Readable.from(
        `id,name,sku\n42,foo,"[1,2]"\n43,bar,"[3,4]"\n`,
        {
          objectMode: false,
        }
      )
      await client.insert({
        table: tableName,
        values: stream,
        format: 'CSVWithNames',
      })
      await assertInsertedValues()
    })

    it('should insert a CSV with names and types', async () => {
      stream = Stream.Readable.from(
        `id,name,sku\nUInt64,String,Array(UInt8)\n42,foo,"[1,2]"\n43,bar,"[3,4]"\n`,
        {
          objectMode: false,
        }
      )
      await client.insert({
        table: tableName,
        values: stream,
        format: 'CSVWithNamesAndTypes',
      })
      await assertInsertedValues()
    })

    it('should throw in case of invalid CSV format', async () => {
      stream = Stream.Readable.from(`foobar,42,,\n`, {
        objectMode: false,
      })
      await expect(
        client.insert({
          table: tableName,
          values: stream,
          format: 'CSV',
        })
      ).rejects.toEqual(
        expect.objectContaining({
          message: expect.stringContaining('Cannot parse input'),
        })
      )
    })

    it('can insert multiple CSV streams at once', async () => {
      const streams: Stream.Readable[] = Array(jsonValues.length)
      const insertStreamPromises = Promise.all(
        jsonValues.map(({ id, name, sku }, i) => {
          const stream = makeRawStream()
          streams[i] = stream
          stream.push(`${id},${name},"${sku}"\n`)
          return client.insert({
            values: stream,
            format: 'CSV',
            table: tableName,
          })
        })
      )
      setTimeout(() => {
        streams.forEach((stream) => stream.push(null))
      }, 100)
      await insertStreamPromises
      await assertJsonValues(client, tableName)
    })
  })

  describe('Custom separated', () => {
    const clickhouse_settings: ClickHouseSettings = {
      format_custom_escaping_rule: 'CSV',
      format_custom_field_delimiter: '^',
    }

    it('should insert a custom separated stream without names or types', async () => {
      stream = Stream.Readable.from(`42^foo^[1,2]\n43^bar^[3,4]\n`, {
        objectMode: false,
      })
      await client.insert({
        table: tableName,
        values: stream,
        format: 'CustomSeparated',
        clickhouse_settings,
      })
      await assertInsertedValues()
    })

    it('should insert a custom separated stream with names', async () => {
      stream = Stream.Readable.from(
        `id^name^sku\n42^foo^[1,2]\n43^bar^[3,4]\n`,
        {
          objectMode: false,
        }
      )
      await client.insert({
        table: tableName,
        values: stream,
        format: 'CustomSeparatedWithNames',
        clickhouse_settings,
      })
      await assertInsertedValues()
    })

    it('should insert a custom separated stream with names and types', async () => {
      stream = Stream.Readable.from(
        `id^name^sku\nUInt64^String^Array(UInt8)\n42^foo^[1,2]\n43^bar^[3,4]\n`,
        {
          objectMode: false,
        }
      )
      await client.insert({
        table: tableName,
        values: stream,
        format: 'CustomSeparatedWithNamesAndTypes',
        clickhouse_settings,
      })
      await assertInsertedValues()
    })

    it('should throw in case of invalid custom separated format', async () => {
      stream = Stream.Readable.from(`foobar^42^^\n`, {
        objectMode: false,
      })
      await expect(
        client.insert({
          table: tableName,
          values: stream,
          format: 'CustomSeparated',
          clickhouse_settings,
        })
      ).rejects.toEqual(
        expect.objectContaining({
          message: expect.stringContaining('Cannot parse input'),
        })
      )
    })

    it('can insert multiple custom-separated streams at once', async () => {
      const streams: Stream.Readable[] = Array(jsonValues.length)
      const insertStreamPromises = Promise.all(
        jsonValues.map(({ id, name, sku }, i) => {
          const stream = makeRawStream()
          streams[i] = stream
          stream.push(`${id}^${name}^[${sku}]\n`)
          return client.insert({
            values: stream,
            format: 'CustomSeparated',
            table: tableName,
            clickhouse_settings,
          })
        })
      )
      setTimeout(() => {
        streams.forEach((stream) => stream.push(null))
      }, 100)
      await insertStreamPromises
      await assertJsonValues(client, tableName)
    })
  })

  async function assertInsertedValues() {
    const result = await client.select({
      query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
      format: 'JSONEachRow',
    })
    expect(await result.json()).toEqual([
      { id: '42', name: 'foo', sku: [1, 2] },
      { id: '43', name: 'bar', sku: [3, 4] },
    ])
  }
})
