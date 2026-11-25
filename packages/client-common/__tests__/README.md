### Common tests and utilities

This folder contains unit and integration test scenarios that we expect to be compatible to every connection,
as well as the shared utilities for effective tests writing.

#### Test client utilities

For integration tests that need a running ClickHouse instance, use `createTestClient()` (or the platform
wrappers `createNodeTestClient()` / `createWebTestClient()`). These connect to the configured test environment
(local single node, local cluster, or cloud), apply environment-specific settings, and rely on the shared
`beforeAll` initializer registered in `utils/client.ts`.

For unit tests that must be runnable **without** a reachable ClickHouse instance, use `createSimpleTestClient()`
from `utils/simple_client.ts` (or the platform wrappers `createSimpleNodeTestClient()` /
`createSimpleWebTestClient()`). This factory lives in a side-effect-free module: importing it never registers the
shared `beforeAll` test-environment initializer and it does not read any connection details from the environment,
so no ClickHouse server is required as long as the test does not issue an actual request.
