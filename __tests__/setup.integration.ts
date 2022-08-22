import { createRandomDatabase, createTestClient } from './utils'
import { TestDatabaseEnvKey } from './global.integration'
import setupAll from './setup.all'

export default async () => {
  setupAll()
  const client = createTestClient()
  const databaseName = await createRandomDatabase(client)
  await client.close()
  process.env[TestDatabaseEnvKey] = databaseName
}
