import { createRandomDatabase, createTestClient } from './utils'
import { TestDatabaseEnvKey } from './global.integration'

export default async () => {
  const client = createTestClient()
  const databaseName = await createRandomDatabase(client)
  await client.close()
  process.env[TestDatabaseEnvKey] = databaseName
}
