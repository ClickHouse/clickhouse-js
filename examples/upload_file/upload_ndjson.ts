import Fs from 'fs'
import Path from 'path'
import split from 'split2'
import { createClient } from '../../src'

void (async () => {
  const client = createClient()
  await client.command({
    query:
      'CREATE TABLE example_ndjson (id UInt64) ENGINE MergeTree() ORDER BY (id)',
  })

  // contains id as numbers in JSONCompactEachRow format ["0"]\n["0"]\n...
  const filename = Path.resolve(__dirname, './data.ndjson')

  await client.insert({
    table: 'example_ndjson',
    values: Fs.createReadStream(filename).pipe(
      // should be removed when "insert" accepts a stream of strings/bytes
      split((row: string) => JSON.parse(row))
    ),
  })

  const response = await client.select({
    query: 'SELECT * from example_ndjson',
    format: 'JSON',
  })

  console.log(await response.json())

  await client.command({
    query: 'DROP TABLE example_ndjson',
  })
})()
