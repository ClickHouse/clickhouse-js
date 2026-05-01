import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Examples that cannot be run in a standard single-node CI environment.
 * All examples are now runnable; they handle missing resources at runtime via env-var checks.
 */
const EXCLUDED_EXAMPLES: string[] = []

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
      CLICKHOUSE_TLS_URL:
        process.env['CLICKHOUSE_TLS_URL'] ??
        'https://server.clickhouseconnect.test:8443',
      CLICKHOUSE_CLUSTER_URL:
        process.env['CLICKHOUSE_CLUSTER_URL'] ?? 'http://localhost:8127',
      EXAMPLE_RUN_DURATION_MS: '8000',
      EXAMPLE_LONG_QUERY_MAX_POLLS: '60',
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
