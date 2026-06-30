// @ts-nocheck
import { env } from "cloudflare:test";
import { createClient } from "@clickhouse/client-web";

/**
 * Test environment setup for the Cloudflare Workers Vitest runner
 * (`@cloudflare/vitest-pool-workers`). The same web specs run here as in the
 * browser runner, but the environment plumbing differs:
 *
 *   - The browser runner reads configuration from `import.meta.env` (populated
 *     by Vitest's `test.env`). The Workers pool does NOT surface `test.env` via
 *     `import.meta.env`, so the connection details are passed as Miniflare
 *     bindings instead and read here from the `cloudflare:test` `env`.
 *   - `nodejs_compat` provides a real `process` object, so rather than replacing
 *     `globalThis.process` (which would clobber the runtime-provided one), we
 *     only copy the test connection variables onto `process.env`.
 */
globalThis.environmentSpecificCreateClient = createClient;

const testEnvKeys = [
  "CLICKHOUSE_CLOUD_HOST",
  "CLICKHOUSE_CLOUD_PASSWORD",
  "CLICKHOUSE_CLOUD_JWT_ACCESS_TOKEN",
  "CLICKHOUSE_TEST_SKIP_INIT",
  "CLICKHOUSE_TEST_ENVIRONMENT",
  "LOG_LEVEL",
];

globalThis.process ??= { env: {} };
globalThis.process.env ??= {};
for (const key of testEnvKeys) {
  const value = env[key];
  if (value !== undefined) {
    globalThis.process.env[key] = value;
  }
}
