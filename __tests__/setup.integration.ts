import { createRandomDatabase, createTestClient } from './utils'
import { TestDatabaseEnvKey } from './global.integration'
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('./setup.all')() // setup rejection handlers

export default async () => {
  const client = createTestClient()
  const databaseName = await createRandomDatabase(client)
  await client.close()
  process.env[TestDatabaseEnvKey] = databaseName
}
