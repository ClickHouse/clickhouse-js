import Stream, { Transform } from 'stream'
import { type ClickHouseClient } from '../../src'
import { createTestClient, guid } from '../utils'
import { createSimpleTable } from './fixtures/simple_table'
import * as fs from 'fs'
import * as Path from 'path'

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
    const readStream = fs.createReadStream(filename)
    const jsonTransform = new Transform({
      transform(data: Buffer, encoding, callback) {
        data
          .toString(encoding)
          .split('\n')
          .forEach((line) => {
            if (!line.length) {
              return
            } else {
              const json = JSON.parse(line)
              this.push(json)
            }
          })
        callback()
      },
      objectMode: true,
    })
    await client.insert({
      table: tableName,
      values: readStream.pipe(jsonTransform),
      format: 'JSONCompactEachRow',
    })

    const response = await client.query({
      query: `SELECT * from ${tableName}`,
      format: 'JSONCompactEachRow',
    })

    const actual: string[] = []
    for await (const row of response.stream()) {
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

    const response = await client.query({
      query: `SELECT * from ${tableName}`,
      format: 'JSONCompactEachRow',
    })

    const actual: string[] = []
    for await (const row of response.stream()) {
      actual.push(row.json())
    }
    expect(actual).toEqual(expected)
  })
})
