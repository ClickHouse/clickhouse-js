### Common tests and utilities

This folder contains unit and integration test scenarios that we expect to be compatible to every connection,
as well as the shared utilities for effective tests writing.

### Test client utilities

#### For integration tests (require ClickHouse)

Use `createTestClient()` or platform-specific wrappers (`createNodeTestClient()`, `createWebTestClient()`) when writing integration tests that need to connect to a ClickHouse instance. These functions:

- Connect to the configured ClickHouse test environment (local, cluster, or cloud)
- Apply environment-specific settings (e.g., `insert_quorum` for clusters)
- Set up a test database when needed
- Are automatically initialized via `beforeAll` hook

#### For unit tests (no ClickHouse required)

Use `createSimpleTestClient()` or platform-specific wrappers (`createSimpleNodeTestClient()`, `createSimpleWebTestClient()`) when writing unit tests that don't need a real ClickHouse connection. These functions:

- Create a client without connecting to ClickHouse
- Don't require `CLICKHOUSE_TEST_SKIP_INIT=1` to be set
- Are suitable for testing client behavior, configuration, and logic
- Bypass all environment-specific initialization

Example:

```typescript
import { createSimpleNodeTestClient } from '../utils/node_client'

it('should validate configuration', () => {
  const client = createSimpleNodeTestClient({
    request_timeout: 5000,
  })
  // Test client configuration without ClickHouse
  expect(client).toBeDefined()
  await client.close()
})
```
