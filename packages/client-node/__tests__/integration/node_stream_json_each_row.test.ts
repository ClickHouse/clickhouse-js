import { type ClickHouseClient } from '@clickhouse/client-common'
import { it, beforeEach, afterEach, expect } from 'vitest'
import { createSimpleTable } from '@test/fixtures/simple_table'
import { assertJsonValues, jsonValues } from '@test/fixtures/test_data'
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
