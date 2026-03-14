import { type ClickHouseClient } from '@clickhouse/client-common'
import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import { createSimpleTable } from '@test/fixtures/simple_table'
import { createTestClient } from '@test/utils/client'
import { guid } from '@test/utils/guid'
import { makeObjectStream } from '../utils/stream'

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
    await expect(insertPromise).rejects.toMatchObject({
      message: expect.stringMatching(
        `Type of 'name' must be String, not UInt64`,
      ),
    })
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
