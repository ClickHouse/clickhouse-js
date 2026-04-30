import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Examples that cannot be run in a standard single-node CI environment.
 */
const EXCLUDED_EXAMPLES = [
  // Requires ClickHouse Cloud credentials
  'examples/node/create_table_cloud.ts',
  'examples/web/create_table_cloud.ts',
  // Requires a multi-node ClickHouse cluster
  'examples/node/create_table_on_premise_cluster.ts',
  'examples/web/create_table_on_premise_cluster.ts',
  // Require TLS certificates and a special ClickHouse TLS instance
  'examples/node/basic_tls.ts',
  'examples/node/mutual_tls.ts',
  // Designed as a production-scenario demo; intentionally uses very long timeouts (up to 400 s)
  'examples/node/long_running_queries_progress_headers.ts',
  'examples/web/long_running_queries_progress_headers.ts',
  'examples/node/long_running_queries_cancel_request.ts',
  // Designed to run indefinitely; they never resolve on their own
  'examples/node/async_insert_without_waiting.ts',
  'examples/node/insert_streaming_with_backpressure.ts',
]

export default defineConfig({
  test: {
    name: 'examples',
    include: ['examples/node/*.ts', 'examples/web/*.ts'],
    exclude: EXCLUDED_EXAMPLES,
    setupFiles: ['vitest.examples.setup.ts'],
    pool: 'forks',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    passWithNoTests: true,
    reporter: ['verbose'],
    env: {
      CLICKHOUSE_URL: process.env['CLICKHOUSE_URL'] ?? 'http://localhost:8123',
      CLICKHOUSE_PASSWORD: process.env['CLICKHOUSE_PASSWORD'] ?? '',
    },
  },
  resolve: {
    alias: {
      '@clickhouse/client': resolve('packages/client-node/src'),
      '@clickhouse/client-web': resolve('packages/client-web/src'),
      '@clickhouse/client-common': resolve('packages/client-common/src'),
    },
  },
})
