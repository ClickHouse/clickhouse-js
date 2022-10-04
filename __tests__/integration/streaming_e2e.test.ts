import Fs from 'fs'
import Path from 'path'
import Stream from 'stream'
import split from 'split2'
import type { Row } from '../../src'
import { type ClickHouseClient } from '../../src'
import { createTestClient, guid } from '../utils'
import { createSimpleTable } from './fixtures/simple_table'

const expected = [
  ['0', 'a', [1, 2]],
  ['1', 'b', [3, 4]],
  ['2', 'c', [5, 6]],
]

describe('streaming e2e', () => {
  let tableName: string
  let client: ClickHouseClient
  beforeEach(async () => {
    client = createTestClient()

    tableName = `streaming_e2e_test_${guid()}`
    await createSimpleTable(client, tableName)
  })

  afterEach(async () => {
    await client.close()
  })

  it('should stream a file', async () => {
    // contains id as numbers in JSONCompactEachRow format ["0"]\n["1"]\n...
    const filename = Path.resolve(
      __dirname,
      './fixtures/streaming_e2e_data.ndjson'
    )

    await client.insert({
      table: tableName,
      values: Fs.createReadStream(filename).pipe(
        // should be removed when "insert" accepts a stream of strings/bytes
        split((row: string) => JSON.parse(row))
      ),
      format: 'JSONCompactEachRow',
    })

    const rs = await client.query({
      query: `SELECT * from ${tableName}`,
      format: 'JSONCompactEachRow',
    })

    const actual: string[] = []
    for await (const rows of rs.stream()) {
      rows.forEach((row: Row) => {
        actual.push(row.json())
      })
    }
    expect(actual).toEqual(expected)
  })

  it('should stream a stream created in-place', async () => {
    await client.insert({
      table: tableName,
      values: Stream.Readable.from(expected),
      format: 'JSONCompactEachRow',
    })

    const rs = await client.query({
      query: `SELECT * from ${tableName}`,
      format: 'JSONCompactEachRow',
    })

    const actual: string[] = []
    for await (const rows of rs.stream()) {
      rows.forEach((row: Row) => {
        actual.push(row.json())
      })
    }
    expect(actual).toEqual(expected)
  })
})
