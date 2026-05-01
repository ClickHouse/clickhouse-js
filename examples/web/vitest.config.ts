import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  test: {
    name: 'examples-web',
    include: ['*.ts'],
    exclude: ['**/*.d.ts', 'vitest.config.ts', 'vitest.setup.ts'],
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
