import { createClient } from '@clickhouse/client'
import Fs from 'fs'
import { cwd } from 'node:process'
import Path from 'path'

void (async () => {
  const client = createClient()

  const { stream } = await client.exec({
    query: `SELECT * from system.numbers LIMIT 10 FORMAT Parquet`,
    clickhouse_settings: {
      /** See also https://clickhouse.com/docs/en/interfaces/formats#parquet-format-settings.
       *  You could specify these (and other settings) here. */
    },
  })

  const filename = Path.resolve(cwd(), './node/out.parquet')
  const writeStream = Fs.createWriteStream(filename)
  stream.pipe(writeStream)
  await new Promise((resolve) => {
    stream.on('end', resolve)
  })

  /*

    (examples) $ pqrs cat node/out.parquet

      #################
      File: node/out.parquet
      #################

      {number: 0}
      {number: 1}
      {number: 2}
      {number: 3}
      {number: 4}
      {number: 5}
      {number: 6}
      {number: 7}
      {number: 8}
      {number: 9}

   */

  await client.close()
})()
