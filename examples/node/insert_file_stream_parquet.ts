import { createClient } from '@clickhouse/client'
import type { Row } from '@clickhouse/client-common'
import Fs from 'fs'
import { cwd } from 'node:process'
import Path from 'path'

void (async () => {
  const client = createClient()
  const tableName = 'insert_file_stream_parquet'
  await client.command({
    query: `DROP TABLE IF EXISTS ${tableName}`,
  })
  await client.command({
    query: `
      CREATE TABLE ${tableName}
      (id UInt64, name String, sku Array(UInt8))
      ENGINE MergeTree()
      ORDER BY (id)
    `,
  })

  const filename = Path.resolve(cwd(), './node/resources/data.parquet')

  /*

  (examples) $ pqrs cat node/resources/data.parquet

    ############################
    File: node/resources/data.parquet
    ############################

    {id: 0, name: [97], sku: [1, 2]}
    {id: 1, name: [98], sku: [3, 4]}
    {id: 2, name: [99], sku: [5, 6]}

   */

  await client.insert({
    table: tableName,
    values: Fs.createReadStream(filename),
    format: 'Parquet',
  })

  const rs = await client.query({
    query: `SELECT * from ${tableName}`,
    format: 'JSONEachRow',
  })

  for await (const rows of rs.stream()) {
    // or just `rows.json()`
    // to consume the entire response at once
    rows.forEach((row: Row) => {
      console.log(row.json())
    })
  }

  await client.close()
})()
