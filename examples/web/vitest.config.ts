import { defineConfig } from 'vitest/config'

/**
 * Examples that cannot be run in a standard single-node CI environment.
 */
const EXCLUDED_EXAMPLES = [
  // Requires ClickHouse Cloud credentials
  'create_table_cloud.ts',
  // Requires a multi-node ClickHouse cluster
  'create_table_on_premise_cluster.ts',
  // Designed as a production-scenario demo; intentionally uses very long timeouts (up to 400 s)
  'long_running_queries_progress_headers.ts',
]

export default defineConfig({
  test: {
    name: 'examples-web',
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
})
