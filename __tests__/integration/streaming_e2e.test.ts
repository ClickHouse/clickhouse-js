import Fs from 'fs'
import Path from 'path'
import Stream from 'stream'
import split from 'split2'
import { type ClickHouseClient } from '../../src'
import { createTestClient, createTable, guid } from '../utils'
import { TestEnv } from '../utils'

const expected = [
  ['0'],
  ['1'],
  ['2'],
  ['3'],
  ['4'],
  ['5'],
  ['6'],
  ['7'],
  ['8'],
  ['9'],
]

describe('streaming e2e', () => {
  let tableName: string
  let client: ClickHouseClient
  beforeEach(async () => {
    client = createTestClient()

    tableName = `streaming_e2e_test_${guid()}`
    await createTable(client, (env) => {
      switch (env) {
        // ENGINE can be omitted in the cloud statements:
        // it will use ReplicatedMergeTree and will add ON CLUSTER as well
        case TestEnv.Cloud:
          return `
              CREATE TABLE ${tableName}
              (id UInt64)
              ORDER BY (id)
            `
        case TestEnv.LocalSingleNode:
          return `
              CREATE TABLE ${tableName}
              (id UInt64)
              ENGINE MergeTree()
              ORDER BY (id)
            `
        case TestEnv.LocalCluster:
          return `
              CREATE TABLE ${tableName} ON CLUSTER '{cluster}'
              (id UInt64)
              ENGINE ReplicatedMergeTree('/clickhouse/{cluster}/tables/{database}/{table}/{shard}', '{replica}')
              ORDER BY (id)
            `
      }
    })
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

    const response = await client.select({
      query: `SELECT * from ${tableName}`,
      format: 'JSONCompactEachRow',
    })

    const actual: string[] = []
    for await (const row of response.asStream()) {
      actual.push(row.json())
    }
    expect(actual).toEqual(expected)
  })

  it('should stream a stream created in-place', async () => {
    await client.insert({
      table: tableName,
      values: Stream.Readable.from(expected),
      format: 'JSONCompactEachRow',
    })

    const response = await client.select({
      query: `SELECT * from ${tableName}`,
      format: 'JSONCompactEachRow',
    })

    const actual: string[] = []
    for await (const row of response.asStream()) {
      actual.push(row.json())
    }
    expect(actual).toEqual(expected)
  })
})
