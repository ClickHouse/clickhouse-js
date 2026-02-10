// @ts-nocheck
import { createClient } from '@clickhouse/client-web'

/**
 * This file is used to set up the test environment for Vitest when running tests in Node.js.
 */
globalThis.environmentSpecificCreateClient = createClient

// Port to import.meta.env once all modules support ESM
globalThis.process = {
  env: {
    CLICKHOUSE_CLOUD_HOST: import.meta.env.CLICKHOUSE_CLOUD_HOST,
    CLICKHOUSE_CLOUD_PASSWORD: import.meta.env.CLICKHOUSE_CLOUD_PASSWORD,
    CLICKHOUSE_CLOUD_JWT_ACCESS_TOKEN: import.meta.env
      .CLICKHOUSE_CLOUD_JWT_ACCESS_TOKEN,
    CLICKHOUSE_TEST_SKIP_INIT: import.meta.env.CLICKHOUSE_TEST_SKIP_INIT,
    CLICKHOUSE_TEST_ENVIRONMENT: import.meta.env.CLICKHOUSE_TEST_ENVIRONMENT,
  },
}
