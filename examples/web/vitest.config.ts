import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

/**
 * Examples that cannot be run in a standard single-node CI environment.
 * All examples are now runnable; they handle missing resources at runtime via env-var checks.
 */
const EXCLUDED_EXAMPLES: string[] = []

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
      CLICKHOUSE_CLUSTER_URL:
        process.env['CLICKHOUSE_CLUSTER_URL'] ?? 'http://localhost:8127',
      CLICKHOUSE_CLOUD_URL: process.env['CLICKHOUSE_CLOUD_URL'],
      CLICKHOUSE_CLOUD_PASSWORD: process.env['CLICKHOUSE_CLOUD_PASSWORD'],
    },
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
