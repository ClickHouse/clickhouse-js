import type { ClickHouseError } from '@clickhouse/client'
import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

/**
 * An example of specifying a role using query parameters
 * See https://clickhouse.com/docs/en/interfaces/http#setting-role-with-query-parameters
 */
void (async () => {
  const format = 'JSON'
  const username = 'role_user'
  const password = 'role_user_password'
  const table1 = 'table_1'
  const table2 = 'table_2'

  // Create 2 tables, a role for each table allowing SELECT, and a user with access to those roles
  const defaultClient = createClient()
  await createOrReplaceUser(username, password)
  const table1Role = await createTableAndGrantAccess(table1, username)
  const table2Role = await createTableAndGrantAccess(table2, username)
  await defaultClient.close()

  // Create a client using a role that only has permission to query table1
  const client = createClient({
    username,
    password,
    role: table1Role,
  })

  // Selecting from table1 is allowed using table1Role
  let rs = await client.query({
    query: `select count(*) from ${table1}`,
    format,
  })
  console.log(
    `Successfully queried from ${table1} using ${table1Role}. Result: `,
    (await rs.json()).data,
  )

  // Selecting from table2 is not allowed using table1Role
  await client
    .query({ query: `select count(*) from ${table2}`, format })
    .catch((e: ClickHouseError) => {
      console.error(
        `Failed to qeury from ${table2} due to error with type: ${e.type}. Message: ${e.message}`,
      )
    })

  // Override the client's role to table2Role, allowing a query to table2
  rs = await client.query({
    query: `select count(*) from ${table2}`,
    format,
    role: table2Role,
  })
  console.log(
    `Successfully queried from ${table2} using ${table2Role}. Result: `,
    (await rs.json()).data,
  )

  // Selecting from table1 is no longer allowed, since table2Role is being used
  await client
    .query({
      query: `select count(*) from ${table1}`,
      format,
      role: table2Role,
    })
    .catch((e: ClickHouseError) => {
      console.error(
        `Failed to qeury from ${table1} due to error with type: ${e.type}. Message: ${e.message}`,
      )
    })

  // Multiple roles can be specified to allowed querying from either table
  rs = await client.query({
    query: `select count(*) from ${table1}`,
    format,
    role: [table1Role, table2Role],
  })
  console.log(
    `Successfully queried from ${table1} using roles: [${table1Role}, ${table2Role}]. Result: `,
    (await rs.json()).data,
  )

  rs = await client.query({
    query: `select count(*) from ${table2}`,
    format,
    role: [table1Role, table2Role],
  })
  console.log(
    `Successfully queried from ${table2} using roles: [${table1Role}, ${table2Role}]. Result: `,
    (await rs.json()).data,
  )

  await client.close()

  async function createOrReplaceUser(username: string, password: string) {
    await defaultClient.command({
      query: `CREATE USER OR REPLACE ${username} IDENTIFIED WITH plaintext_password BY '${password}'`,
    })
  }

  async function createTableAndGrantAccess(
    tableName: string,
    username: string,
  ) {
    const role = `${tableName}_role`

    await defaultClient.command({
      query: `
        CREATE OR REPLACE TABLE ${tableName}
        (id UInt32, name String, sku Array(UInt32))
        ENGINE MergeTree()
        ORDER BY (id)
      `,
    })

    await defaultClient.command({ query: `CREATE ROLE OR REPLACE ${role}` })
    await defaultClient.command({
      query: `GRANT SELECT ON ${tableName} TO ${role}`,
    })
    await defaultClient.command({ query: `GRANT ${role} TO ${username}` })

    return role
  }
})()
