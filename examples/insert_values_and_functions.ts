import type { ClickHouseSettings } from '@clickhouse/client'
import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

interface Data {
  id: string
  timestamp: number
  email: string
  name: string | null
}

/**
 * An example how to send an INSERT INTO ... VALUES ... query that requires additional functions call.
 * Inspired by https://github.com/ClickHouse/clickhouse-js/issues/239
 */
void (async () => {
  const tableName = 'insert_values_and_functions'
  const client = createClient()
  // Recommended for cluster usage to avoid situations where a query processing error occurred after the response code
  // and HTTP headers were sent to the client, as it might happen before the changes were applied on the server.
  // See https://clickhouse.com/docs/en/interfaces/http/#response-buffering
  const commandSettings: ClickHouseSettings = {
    wait_end_of_query: 1,
  }

  // Prepare an example table
  await client.command({
    query: `DROP TABLE IF EXISTS ${tableName}`,
    clickhouse_settings: commandSettings,
  })
  await client.command({
    query: `
      CREATE TABLE ${tableName} (
        id String,
        timestamp DateTime64(3, 'UTC'),
        email String,
        name Nullable(String)
      )
      ENGINE MergeTree()
      ORDER BY (id)
    `,
    clickhouse_settings: commandSettings,
  })

  // Here we are assuming that we are getting these rows from somewhere...
  const rows = getRows(20_000)

  // Generate the query and insert the values
  const insertQuery = `
    INSERT INTO ${tableName}
      (id, timestamp, email, name)
    VALUES
      ${rows.map((r) => toInsertValue(r)).join(',')}
  `
  await client.command({
    query: insertQuery,
    clickhouse_settings: commandSettings,
  })

  // Get a few back and print those rows to check what was inserted
  const sampleResultSet = await client.query({
    query: `SELECT * FROM ${tableName} ORDER BY rand() LIMIT 3`,
    format: 'JSONEachRow',
  })
  console.info(`Sample inserted rows:`)
  const sampleRows = await sampleResultSet.json<Array<Data>>()
  sampleRows.forEach((row) => {
    console.info(row)
  })

  // Close it during your application graceful shutdown
  await client.close()
})()

function getRows(n: number): Array<Data> {
  const now = Date.now() // UNIX timestamp in milliseconds
  return [...new Array(n)].map((_, i) => ({
    id: Buffer.from(i.toString(10)).toString('hex'),
    timestamp: now - i * 1000, // subtract one second for each row
    email: `email${i}@example.com`,
    name: i % 2 === 0 ? `Name${i}` : null, // for every second row it is NULL
  }))
}

// Generates something like:
// (unhex('42'), '1623677409123', 'email42@example.com', 'Name')
// or
// (unhex('144'), '1623677409123', 'email144@example.com', NULL)
// if name is null.
function toInsertValue(row: Data): string {
  const id = `unhex('${row.id}')`
  const timestamp = `'${row.timestamp}'`
  const email = `'${row.email}'`
  const name = row.name === null ? 'NULL' : `'${row.name}'`
  return `(${id}, ${timestamp}, ${email}, ${name})`
}
