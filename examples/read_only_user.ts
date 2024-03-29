import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'
import { randomUUID } from 'crypto'

/**
 * An illustration of limitations and client-specific settings for users created in `READONLY = 1` mode.
 */
void (async () => {
  const defaultClient = createClient()

  // using the default (non-read-only) user to create a read-only one for the purposes of the example
  const guid = randomUUID().replace(/-/g, '')
  const readOnlyUsername = `clickhouse_js_examples_readonly_user_${guid}`
  const readOnlyPassword = `${guid}_pwd`
  const commands = [
    `
      CREATE USER ${readOnlyUsername}
      IDENTIFIED WITH sha256_password BY '${readOnlyPassword}'
      DEFAULT DATABASE default
      SETTINGS readonly = 1
    `,
    `
      GRANT SHOW TABLES, SELECT
      ON default.*
      TO ${readOnlyUsername}
    `,
  ]
  for (const query of commands) {
    await defaultClient.command({
      query,
      clickhouse_settings: {
        wait_end_of_query: 1,
      },
    })
  }
  console.log(
    `Created user ${readOnlyUsername} with restricted access to the system database`,
  )
  printSeparator()

  // and a test table with some data in there
  const testTableName = 'clickhouse_js_examples_readonly_user_test_data'
  await defaultClient.command({
    query: `
      CREATE OR REPLACE TABLE ${testTableName}
      (id UInt64, name String)
      ENGINE MergeTree()
      ORDER BY (id)
    `,
    clickhouse_settings: {
      wait_end_of_query: 1,
    },
  })
  await defaultClient.insert({
    table: testTableName,
    values: [
      { id: 12, name: 'foo' },
      { id: 42, name: 'bar' },
    ],
    format: 'JSONEachRow',
  })

  // Read-only user
  let readOnlyUserClient = createClient({
    username: readOnlyUsername,
    password: readOnlyPassword,
  })

  // read-only user cannot insert the data into the table
  await readOnlyUserClient
    .insert({
      table: testTableName,
      values: [
        { id: 12, name: 'foo' },
        { id: 42, name: 'bar' },
      ],
      format: 'JSONEachRow',
    })
    .catch((err) => {
      console.error(
        '[Expected error] Readonly user cannot insert the data into the table. Cause:\n',
        err,
      )
    })
  printSeparator()

  // ... cannot query from system.users because no grant (system.numbers will still work, though)
  await readOnlyUserClient
    .query({
      query: 'SELECT * FROM system.users LIMIT 5',
      format: 'JSONEachRow',
    })
    .catch((err) => {
      console.error(
        '[Expected error] Cannot query system.users cause it was not granted. Cause:\n',
        err,
      )
    })
  printSeparator()

  // ... can query the test table since it is granted
  const rs = await readOnlyUserClient.query({
    query: `SELECT * FROM ${testTableName}`,
    format: 'JSONEachRow',
  })
  console.log('Select result:', await rs.json())
  printSeparator()

  // ... cannot use ClickHouse settings
  await readOnlyUserClient.close()
  readOnlyUserClient = createClient({
    username: readOnlyUsername,
    password: readOnlyPassword,
    clickhouse_settings: {
      send_progress_in_http_headers: 1,
    },
  })

  await readOnlyUserClient
    .query({
      query: `SELECT * FROM ${testTableName}`,
      format: 'JSONEachRow',
    })
    .catch((err) => {
      console.error(
        `[Expected error] Cannot modify 'send_progress_in_http_headers' setting in readonly mode. Cause:\n`,
        err,
      )
    })
  printSeparator()

  // ... cannot use response compression. Request compression is still allowed.
  await readOnlyUserClient.close()
  readOnlyUserClient = createClient({
    username: readOnlyUsername,
    password: readOnlyPassword,
    compression: {
      response: true,
    },
  })
  await readOnlyUserClient
    .query({
      query: `SELECT * FROM ${testTableName}`,
      format: 'JSONEachRow',
    })
    .catch((err) => {
      console.error(
        `[Expected error] Cannot enable compression setting in readonly mode. Cause:\n`,
        err,
      )
    })
  printSeparator()

  console.log('All done!')

  await readOnlyUserClient.close()
  await defaultClient.close()
})()

function printSeparator() {
  console.log(
    '------------------------------------------------------------------------',
  )
}
