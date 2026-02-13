import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import { fileURLToPath } from 'node:url'

const browser = process.env.BROWSER ?? 'chromium'
if (browser !== 'chromium' && browser !== 'firefox' && browser !== 'webkit') {
  throw new Error(
    `Unsupported browser for tests: [${browser}]. Supported browsers are: chromium, firefox, webkit.`,
  )
}

export default defineConfig({
  test: {
    // Increase maxWorkers to speed up integration tests
    // as we're not bound by the CPU here.
    maxWorkers: '400%',
    // Cover the Cloud instance wake-up time
    testTimeout: 300_000,
    slowTestThreshold: 10_000,
    setupFiles: ['vitest.web.setup.ts'],
    // include: ['unit/*.test.ts', 'utils/*.test.ts'],
    include: [
      'packages/client-common/__tests__/utils/*.test.ts',
      'packages/client-common/__tests__/integration/*.test.ts',
      'packages/client-web/__tests__/integration/*.test.ts',
      'packages/client-web/__tests__/unit/*.test.ts',
    ],
    browser: {
      enabled: true,
      provider: playwright(),
      // https://vitest.dev/config/browser/playwright
      instances: [{ browser }],
    },
    coverage: {
      provider: 'istanbul',
      reporter: ['lcov', 'text'],
      include: [
        'packages/client-common/src/**/*.ts',
        'packages/client-web/src/**/*.ts',
      ],
      exclude: [
        'packages/**/version.ts',
        'packages/client-common/src/clickhouse_types.ts',
        'packages/client-common/src/connection.ts',
        'packages/client-common/src/result.ts',
        'packages/client-common/src/ts_utils.ts',
        'packages/client-common/__tests__/utils/*.ts',
      ],
    },
    env: {
      CLICKHOUSE_CLOUD_HOST: process.env.CLICKHOUSE_CLOUD_HOST,
      CLICKHOUSE_CLOUD_PASSWORD: process.env.CLICKHOUSE_CLOUD_PASSWORD,
      CLICKHOUSE_CLOUD_JWT_ACCESS_TOKEN:
        process.env.CLICKHOUSE_CLOUD_JWT_ACCESS_TOKEN,
      CLICKHOUSE_TEST_SKIP_INIT: process.env.CLICKHOUSE_TEST_SKIP_INIT,
      CLICKHOUSE_TEST_ENVIRONMENT: process.env.CLICKHOUSE_TEST_ENVIRONMENT,
    },
  },
  resolve: {
    // Use the unittest entry point to get the source files instead of built files
    conditions: ['unittest'],
    alias: {
      '@clickhouse/client-common': fileURLToPath(
        new URL('./packages/client-common/src', import.meta.url),
      ),
      '@clickhouse/client-web': fileURLToPath(
        new URL('./packages/client-web', import.meta.url),
      ),
      '@test': fileURLToPath(
        new URL('./packages/client-common/__tests__', import.meta.url),
      ),
    },
  },
})
