import type { ClickHouseClient } from '@clickhouse/client'
import { createClient, drainStream } from '@clickhouse/client'
import * as avro from 'avsc'
import Fs from 'fs'
import { cwd } from 'node:process'
import Path from 'path'

/** If a particular format is not supported in the {@link ClickHouseClient.insert} method, there is still a workaround:
 *  you could use the {@link ClickHouseClient.exec} method to insert data in an arbitrary format.
 *  In this scenario, we are inserting the data from a stream in AVRO format.
 *  Related issue with a question: https://github.com/ClickHouse/clickhouse-js/issues/418 */

void (async () => {
  const client = createClient()
  const tableName = 'chjs_avro_stream_insert_demo'
  await prepareTable(client, tableName)

  const avroDataFilePath = Path.resolve(cwd(), './node/resources/data.avro')
  const avroStream = await getAvroDataFileStream(avroDataFilePath)

  // Important #1: remember to add the FORMAT clause here, as `exec` takes a raw query in the arguments!
  const execResult = await client.exec({
    query: `INSERT INTO ${tableName} FORMAT Avro`,
    values: avroStream,
  })

  // Important #2: the result stream contains nothing useful for an INSERT query (usually, it is just `Ok.`),
  // and should be immediately drained to release the underlying connection (i.e., HTTP keep-alive socket).
  await drainStream(execResult.stream)

  // Verifying that the data was properly inserted; using `JSONEachRow` output format for convenience
  const rs = await client.query({
    query: `SELECT * FROM ${tableName}`,
    format: 'JSONEachRow',
  })
  console.log('Inserted data:', await rs.json())
})()

async function prepareTable(client: ClickHouseClient, tableName: string) {
  await client.command({
    query: `
      CREATE OR REPLACE TABLE ${tableName}
      (id Int32, name String, email String, isActive Boolean)
      ENGINE MergeTree()
      ORDER BY (id)
    `,
    clickhouse_settings: {
      // If on cluster: wait until the changes are applied on all nodes.
      // See https://clickhouse.com/docs/en/interfaces/http/#response-buffering
      wait_end_of_query: 1,
    },
  })
}

// A simple AVRO data file stream generator for the sake of this example.
// See also: https://clickhouse.com/docs/interfaces/formats/Avro#inserting-data
async function getAvroDataFileStream(filePath: string) {
  const userSchema: avro.Schema = {
    type: 'record',
    name: 'User',
    fields: [
      { name: 'id', type: 'int' },
      { name: 'name', type: 'string' },
      { name: 'email', type: 'string' },
      { name: 'isActive', type: 'boolean' },
    ],
  }
  const userEncoder = avro.createFileEncoder(filePath, userSchema)
  const users = [
    {
      id: 1001,
      name: 'Jane Smith',
      email: 'jane.smith@example.com',
      isActive: true,
    },
    {
      id: 1002,
      name: 'John Doe',
      email: 'john.doe@unknown.com',
      isActive: false,
    },
  ]

  for (const user of users) {
    userEncoder.write(user)
  }

  // Wait until the data is flushed to the file
  await new Promise((resolve, reject) => {
    userEncoder.end(() => resolve(true))
    userEncoder.on('error', reject)
  })

  return Fs.createReadStream(filePath)
}
