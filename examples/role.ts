import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

void (async () => {
  const client = createClient({
    role: 'role_name_1',
  })

  // with a role defined in the client configuration, all queries will use the specified role
  await client.command({
    query: `SELECT * FROM SECURED_TABLE`,
  })

  // one or more roles can be specified in a query as well, to override the role(s) set for the client
  const rows1 = await client.query({
    query: `SELECT * FROM VERY_SECURED_TABLE`,
    format: 'JSONEachRow',
    role: ['highly_privileged_role'],
  })

  console.log(await rows1.json())

  await client.close()
})()
