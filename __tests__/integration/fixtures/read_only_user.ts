import {
  getClickHouseTestEnvironment,
  getTestDatabaseName,
  guid,
  TestEnv,
} from '../../utils'
import { ClickHouseClient } from '../../../src'

export async function createReadOnlyUser(client: ClickHouseClient) {
  const username = `clickhousejs__read_only_user_${guid()}`
  const database = getTestDatabaseName()
  const env = getClickHouseTestEnvironment()
  let createUser: string
  let grant: string
  switch (env) {
    case TestEnv.Cloud: // we do not need 'ON CLUSTER' in the cloud
    case TestEnv.LocalSingleNode:
      createUser = `
          CREATE USER ${username} 
          DEFAULT DATABASE ${database}
          SETTINGS readonly = 1
        `
      grant = `
          GRANT SHOW TABLES, SELECT 
          ON ${database}.* 
          TO ${username}
        `
      break
    case TestEnv.LocalCluster:
      createUser = `
          CREATE USER ${username} 
          ON CLUSTER '{cluster}'
          DEFAULT DATABASE ${database}
          SETTINGS readonly = 1
        `
      grant = `
          GRANT ON CLUSTER '{cluster}'
          SHOW TABLES, SELECT 
          ON ${database}.* 
          TO ${username}
        `
      break
  }
  for (const query of [createUser, grant]) {
    await client.command({ query, format: false }).then((r) => r.text())
  }
  console.log(
    `Created user ${username} with default database ${database} ` +
      'and restricted access to the system database'
  )

  return {
    username,
  }
}
