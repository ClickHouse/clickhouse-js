import { createRandomDatabase, createTestClient } from './client';

before(async () => {
  const client = await createTestClient();
  await createRandomDatabase(client);
  await client.close();
});
