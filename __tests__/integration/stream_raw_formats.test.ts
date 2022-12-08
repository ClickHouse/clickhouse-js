import { createTestClient, guid, makeRawStream } from '../utils'
import type { ClickHouseClient, ClickHouseSettings } from '../../src'
import { createSimpleTable } from './fixtures/simple_table'
import Stream from 'stream'
import { assertJsonValues, jsonValues } from './fixtures/test_data'
import type { RawDataFormat } from '../../src/data_formatter'

describe('stream raw formats', () => {
  let client: ClickHouseClient
  let tableName: string

  beforeEach(async () => {
    tableName = `insert_stream_raw_${guid()}`
    client = createTestClient()
    await createSimpleTable(client, tableName)
  })
  afterEach(async () => {
    await client.close()
  })

  it('should throw in case of invalid format of data', async () => {
    const stream = Stream.Readable.from(
      `"baz","foo","[1,2]"\n43,"bar","[3,4]"\n`,
      {
        objectMode: false,
      }
    )
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

  describe('TSV', () => {
    it('should insert a TSV without names or types', async () => {
      const values = `42\tfoo\t[1,2]\n43\tbar\t[3,4]\n`
      const stream = Stream.Readable.from(values, {
        objectMode: false,
      })
      await client.insert({
        table: tableName,
        values: stream,
        format: 'TabSeparated',
      })
      await assertInsertedValues('TabSeparated', values)
    })

    it('should insert a TSV with names', async () => {
      const values = `id\tname\tsku\n42\tfoo\t[1,2]\n43\tbar\t[3,4]\n`
      const stream = Stream.Readable.from(values, {
        objectMode: false,
      })
      await client.insert({
        table: tableName,
        values: stream,
        format: 'TabSeparatedWithNames',
      })
      await assertInsertedValues('TabSeparatedWithNames', values)
    })

    it('should insert a TSV with names and types', async () => {
      const values = `id\tname\tsku\nUInt64\tString\tArray(UInt8)\n42\tfoo\t[1,2]\n43\tbar\t[3,4]\n`
      const stream = Stream.Readable.from(values, {
        objectMode: false,
      })
      await client.insert({
        table: tableName,
        values: stream,
        format: 'TabSeparatedWithNamesAndTypes',
      })
      await assertInsertedValues('TabSeparatedWithNamesAndTypes', values)
    })

    it('should insert a TSV (unescaped)', async () => {
      const values = `42\t\\bfoo\t[1,2]\n43\tba\\tr\t[3,4]\n`
      const stream = Stream.Readable.from(values, {
        objectMode: false,
      })
      await client.insert({
        table: tableName,
        values: stream,
        format: 'TabSeparatedRaw',
      })
      await assertInsertedValues('TabSeparatedRaw', values)
    })

    it('should throw in case of invalid TSV format', async () => {
      const stream = Stream.Readable.from(`foobar\t42\n`, {
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
      const values = `42,"foo","[1,2]"\n43,"bar","[3,4]"\n`
      const stream = Stream.Readable.from(values, {
        objectMode: false,
      })
      await client.insert({
        table: tableName,
        values: stream,
        format: 'CSV',
      })
      await assertInsertedValues('CSV', values)
    })

    it('should insert a CSV with names', async () => {
      const values = `"id","name","sku"\n42,"foo","[1,2]"\n43,"bar","[3,4]"\n`
      const stream = Stream.Readable.from(values, {
        objectMode: false,
      })
      await client.insert({
        table: tableName,
        values: stream,
        format: 'CSVWithNames',
      })
      await assertInsertedValues('CSVWithNames', values)
    })

    it('should insert a CSV with wrong names', async () => {
      const values = `"foo","name","sku"
42,"foo","[1,2]"
43,"bar","[3,4]"
`
      const stream = Stream.Readable.from(values, {
        objectMode: false,
      })
      await client.insert({
        table: tableName,
        values: stream,
        format: 'CSVWithNames',
      })
      await assertInsertedValues(
        'CSVWithNames',
        `"id","name","sku"
0,"foo","[1,2]"
0,"bar","[3,4]"
`
      )
    })

    it('should insert a CSV with names and types', async () => {
      const values = `"id","name","sku"\n"UInt64","String","Array(UInt8)"\n42,"foo","[1,2]"\n43,"bar","[3,4]"\n`
      const stream = Stream.Readable.from(values, {
        objectMode: false,
      })
      await client.insert({
        table: tableName,
        values: stream,
        format: 'CSVWithNamesAndTypes',
      })
      await assertInsertedValues('CSVWithNamesAndTypes', values)
    })

    it('should throw in case of a wrong type in CSV format', async () => {
      const stream = Stream.Readable.from(
        `"id","name","sku"\n"UInt64","UInt64","Array(UInt8)"\n42,"foo","[1,2]"\n43,"bar","[3,4]"\n`,
        {
          objectMode: false,
        }
      )
      await expect(
        client.insert({
          table: tableName,
          values: stream,
          format: 'CSVWithNamesAndTypes',
        })
      ).rejects.toEqual(
        expect.objectContaining({
          message: expect.stringContaining(
            `Type of 'name' must be String, not UInt64`
          ),
        })
      )
    })

    it('should throw in case of invalid CSV format', async () => {
      const stream = Stream.Readable.from(`"foobar","42",,\n`, {
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
      const values = `42^"foo"^"[1,2]"\n43^"bar"^"[3,4]"\n`
      const stream = Stream.Readable.from(values, {
        objectMode: false,
      })
      await client.insert({
        table: tableName,
        values: stream,
        format: 'CustomSeparated',
        clickhouse_settings,
      })
      await assertInsertedValues('CustomSeparated', values, clickhouse_settings)
    })

    it('should insert a custom separated stream with names', async () => {
      const values = `"id"^"name"^"sku"\n42^"foo"^"[1,2]"\n43^"bar"^"[3,4]"\n`
      const stream = Stream.Readable.from(values, {
        objectMode: false,
      })
      await client.insert({
        table: tableName,
        values: stream,
        format: 'CustomSeparatedWithNames',
        clickhouse_settings,
      })
      await assertInsertedValues(
        'CustomSeparatedWithNames',
        values,
        clickhouse_settings
      )
    })

    it('should insert a custom separated stream with names and types', async () => {
      const values = `"id"^"name"^"sku"\n"UInt64"^"String"^"Array(UInt8)"\n42^"foo"^"[1,2]"\n43^"bar"^"[3,4]"\n`
      const stream = Stream.Readable.from(values, {
        objectMode: false,
      })
      await client.insert({
        table: tableName,
        values: stream,
        format: 'CustomSeparatedWithNamesAndTypes',
        clickhouse_settings,
      })
      await assertInsertedValues(
        'CustomSeparatedWithNamesAndTypes',
        values,
        clickhouse_settings
      )
    })

    it('should throw in case of invalid custom separated format', async () => {
      const stream = Stream.Readable.from(`"foobar"^"42"^^\n`, {
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

  async function assertInsertedValues<T>(
    format: RawDataFormat,
    expected: T,
    clickhouse_settings?: ClickHouseSettings
  ) {
    const result = await client.query({
      query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
      clickhouse_settings,
      format,
    })
    expect(await result.text()).toEqual(expected)
  }
})
