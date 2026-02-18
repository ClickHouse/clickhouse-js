import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import { fileURLToPath } from 'node:url'

const browser = process.env.BROWSER ?? 'chromium'
if (browser !== 'chromium' && browser !== 'firefox' && browser !== 'webkit') {
  throw new Error(
    `Unsupported BROWSER: [${browser}]. Supported browsers are: chromium, firefox, webkit.`,
  )
}

const testMode = process.env.TEST_MODE
if (
  testMode !== 'unit' &&
  testMode !== 'integration' &&
  testMode !== 'jwt' &&
  testMode !== 'common' &&
  testMode !== 'common-integration' &&
  testMode !== 'all'
) {
  throw new Error(
    `Unsupported TEST_MODE: [${testMode}]. Supported modes are: unit, integration, jwt, all.`,
  )
}

const collections = {
  unit: [
    'packages/client-common/__tests__/unit/*.test.ts',
    'packages/client-common/__tests__/utils/*.test.ts',
    'packages/client-web/__tests__/unit/*.test.ts',
  ],
  integration: [
    'packages/client-common/__tests__/integration/*.test.ts',
    'packages/client-web/__tests__/integration/*.test.ts',
  ],
  // JWT tests require a specific environment setup (a valid access token)
  // This list is integration + JWT tests
  jwt: [
    'packages/client-common/__tests__/integration/*.test.ts',
    'packages/client-web/__tests__/integration/*.test.ts',
    'packages/client-web/__tests__/jwt/*.test.ts',
  ],
  common: [
    'packages/client-common/__tests__/unit/*.test.ts',
    'packages/client-common/__tests__/utils/*.test.ts',
  ],
  'common-integration': [
    'packages/client-common/__tests__/integration/*.test.ts',
  ],
  all: [
    'packages/client-common/__tests__/unit/*.test.ts',
    'packages/client-common/__tests__/utils/*.test.ts',
    'packages/client-common/__tests__/integration/*.test.ts',
    'packages/client-web/__tests__/unit/*.test.ts',
    'packages/client-web/__tests__/integration/*.test.ts',
    'packages/client-web/__tests__/jwt/*.test.ts',
  ],
}

export default defineConfig({
  test: {
    // Increase maxWorkers to speed up integration tests
    // as we're not bound by the CPU here.
    maxWorkers: '400%',
    // Cover the Cloud instance wake-up time
    hookTimeout: 300_000,
    testTimeout: 300_000,
    slowTestThreshold: testMode === 'unit' ? 10_000 : undefined,
    setupFiles: ['vitest.web.setup.ts'],
    include: collections[testMode],
    coverage: {
      enabled: process.env.VITEST_COVERAGE === 'true',
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
      OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
      OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      OTEL_EXPORTER_OTLP_HEADERS: process.env.OTEL_EXPORTER_OTLP_HEADERS,

      GITHUB_SHA: process.env.GITHUB_SHA,
      GITHUB_RUN_ID: process.env.GITHUB_RUN_ID,
      GITHUB_JOB_NAME: process.env.GITHUB_JOB_NAME,
      GITHUB_WORKFLOW: process.env.GITHUB_WORKFLOW,
    },
    experimental: {
      openTelemetry: {
        enabled: process.env.VITEST_OTEL_ENABLED === 'true',
        sdkPath: './vitest.node.otel.js',
        browserSdkPath: './vitest.web.otel.js',
      },
    },
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser }],
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
