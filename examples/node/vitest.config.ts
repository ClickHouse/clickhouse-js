import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Examples that cannot be run in a standard single-node CI environment.
 */
const EXCLUDED_EXAMPLES = [
  // Requires ClickHouse Cloud credentials
  'create_table_cloud.ts',
  // Requires a multi-node ClickHouse cluster
  'create_table_on_premise_cluster.ts',
  // Require TLS certificates and a special ClickHouse TLS instance
  'basic_tls.ts',
  'mutual_tls.ts',
  // Designed as a production-scenario demo; intentionally uses very long timeouts (up to 400 s)
  'long_running_queries_progress_headers.ts',
  'long_running_queries_cancel_request.ts',
  // Designed to run indefinitely; they never resolve on their own
  'async_insert_without_waiting.ts',
  'insert_streaming_with_backpressure.ts',
]

export default defineConfig({
  test: {
    name: 'examples-node',
    include: ['*.ts'],
    exclude: EXCLUDED_EXAMPLES,
    setupFiles: ['vitest.setup.ts'],
    pool: 'forks',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    passWithNoTests: true,
    reporters: ['verbose'],
    env: {
      CLICKHOUSE_URL: process.env['CLICKHOUSE_URL'] ?? 'http://localhost:8123',
      CLICKHOUSE_PASSWORD: process.env['CLICKHOUSE_PASSWORD'] ?? '',
    },
  },
  resolve: {
    alias: {
      '@clickhouse/client': resolve(here, '../../packages/client-node/src'),
      '@clickhouse/client-common': resolve(
        here,
        '../../packages/client-common/src',
      ),
    },
  },
})
