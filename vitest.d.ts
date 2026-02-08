/**
 * This function is defined by each test environment setup file (e.g. vitest.node.setup.ts) and should return a ClickHouse client instance.
 * It is used in the common test setup (client.ts) to create a client instance for integration tests.
 * The reason for this function is that the way to create a client instance may differ between environments (e.g. Node.js vs web).
 * By defining this function in the environment-specific setup file, we can keep the common test setup code clean and environment-agnostic.
 * Note that this function should not be imported directly in test files. Instead, it should be used indirectly through the common test setup.
 */
declare let environmentSpecificCreateClient: any
