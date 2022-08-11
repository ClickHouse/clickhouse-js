import { createRandomDatabase, createTestClient } from './client';

void (async () => {
  const client = await createTestClient();
  await createRandomDatabase(client);
  await client.close();
})();
