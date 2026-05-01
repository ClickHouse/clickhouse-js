import type { Row } from '@clickhouse/client'
import { createClient } from '@clickhouse/client'
import Fs from 'node:fs'
import { cwd } from 'node:process'
import Path from 'node:path'
import Readline from 'node:readline'
import { Readable } from 'node:stream'

const client = createClient()
const tableName = 'insert_file_stream_ndjson'
await client.command({
  query: `DROP TABLE IF EXISTS ${tableName}`,
})
await client.command({
  query: `
    CREATE TABLE ${tableName} (id UInt64)
    ENGINE MergeTree()
    ORDER BY (id)
  `,
})

// contains id as numbers in JSONCompactEachRow format ["0"]\n["0"]\n...
// see also: NDJSON format
const filename = Path.resolve(cwd(), './node/resources/data.ndjson')

// Read the file line by line and parse each line as JSON, then expose the
// parsed rows as a Readable stream that the client can consume.
const lines = Readline.createInterface({
  input: Fs.createReadStream(filename),
  crlfDelay: Infinity,
})
const fileStream = Readable.from(
  (async function* () {
    for await (const line of lines) {
      if (line.length > 0) yield JSON.parse(line) as unknown[]
    }
  })(),
)

await client.insert({
  table: tableName,
  values: fileStream,
  format: 'JSONCompactEachRow',
})

const rs = await client.query({
  query: `SELECT * from ${tableName}`,
  format: 'JSONEachRow',
})

for await (const rows of rs.stream()) {
  // or just `rows.text()` / `rows.json()`
  // to consume the entire response at once
  rows.forEach((row: Row) => {
    console.log(row.json())
  })
}

await client.close()
