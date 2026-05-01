import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'examples-node',
    include: ['*.ts'],
    exclude: ['vitest.config.ts', 'vitest.setup.ts'],
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
    },
  },
})
