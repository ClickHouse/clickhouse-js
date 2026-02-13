import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import { fileURLToPath } from 'node:url'

const testMode = process.env.TEST_MODE ?? 'unit'
const browser = process.env.BROWSER ?? 'chromium'

if (browser !== 'chromium' && browser !== 'firefox' && browser !== 'webkit') {
  throw new Error(
    `Unsupported browser for tests: [${browser}]. Supported browsers are: chromium, firefox, webkit.`,
  )
}

// Base configuration for all client-common tests
const baseConfig = {
  resolve: {
    alias: {
      '@clickhouse/client-common': 'packages/client-common/src',
      '@clickhouse/client-node': 'packages/client-node/src',
      '@test': 'packages/client-common/__tests__',
    },
  },
}

// Configuration for unit tests
const unitConfig = defineConfig({
  ...baseConfig,
  test: {
    include: [
      'packages/client-common/__tests__/unit/*.test.ts',
      'packages/client-common/__tests__/utils/*.test.ts',
    ],
    coverage: {
      provider: 'istanbul',
    },
    experimental: {
      openTelemetry: {
        enabled: process.env.VITEST_OTEL_ENABLED === 'true',
        sdkPath: './vitest.node.otel.js',
      },
    },
  },
})

// Configuration for unit tests in web environment
const unitWebConfig = defineConfig({
  test: {
    setupFiles: ['vitest.web.setup.ts'],
    include: [
      'packages/client-common/__tests__/unit/*.test.ts',
      'packages/client-common/__tests__/utils/*.test.ts',
    ],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser }],
    },
    coverage: {
      provider: 'istanbul',
    },
    experimental: {
      openTelemetry: {
        enabled: process.env.VITEST_OTEL_ENABLED === 'true',
        sdkPath: './vitest.node.otel.js',
      },
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

// Configuration for integration tests
const integrationConfig = defineConfig({
  ...baseConfig,
  test: {
    // Increase maxWorkers to speed up integration tests
    // as we're not bound by the CPU here.
    maxWorkers: '400%',
    // Cover the Cloud instance wake-up time
    testTimeout: 300_000,
    slowTestThreshold: 10_000,
    include: ['packages/client-common/__tests__/integration/*.test.ts'],
    setupFiles: ['vitest.node.setup.ts'],
    coverage: {
      provider: 'istanbul',
    },
    experimental: {
      openTelemetry: {
        enabled: process.env.VITEST_OTEL_ENABLED === 'true',
        sdkPath: './vitest.node.otel.js',
      },
    },
  },
})

// Export the appropriate config based on TEST_MODE
export default testMode === 'integration'
  ? integrationConfig
  : testMode === 'unit-web'
    ? unitWebConfig
    : unitConfig
