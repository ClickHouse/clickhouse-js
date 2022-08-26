import Fs from 'fs'
import Path from 'path'
import split from 'split2'
import { type ClickHouseClient } from '../../src'
import { createTestClient, createTable, guid } from '../utils'
import { TestEnv } from '../utils'

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

  it('streams a file', async () => {
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
    })

    const response = await client.select({
      query: `SELECT * from ${tableName}`,
      format: 'JSONCompactEachRow',
    })

    let i = 0
    for await (const row of response.asStream()) {
      expect(row.json()).toEqual([String(i++)])
    }
  })
})
