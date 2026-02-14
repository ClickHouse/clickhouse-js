import { defineConfig } from 'vitest/config'

const testMode = process.env.TEST_MODE
if (
  testMode !== 'unit' &&
  testMode !== 'integration' &&
  testMode !== 'tls' &&
  testMode !== 'common' &&
  testMode !== 'common-integration' &&
  testMode !== 'all'
) {
  throw new Error(
    `Unsupported TEST_MODE: [${testMode}]. Supported modes are: unit, integration, tls, common, common-integration, all.`,
  )
}

const collections = {
  unit: [
    'packages/client-node/__tests__/unit/*.test.ts',
    'packages/client-node/__tests__/utils/*.test.ts',
  ],
  integration: [
    'packages/client-node/__tests__/integration/*.test.ts',
    'packages/client-common/__tests__/integration/*.test.ts',
  ],
  // TLS tests require a specific environment setup
  // This list is integration + TLS tests
  tls: [
    'packages/client-node/__tests__/integration/*.test.ts',
    'packages/client-common/__tests__/integration/*.test.ts',
    'packages/client-node/__tests__/tls/*.test.ts',
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
    'packages/client-node/__tests__/tls/*.test.ts',
    'packages/client-node/__tests__/unit/*.test.ts',
    'packages/client-node/__tests__/utils/*.test.ts',
    'packages/client-node/__tests__/integration/*.test.ts',
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
    include: collections[testMode],
    setupFiles: ['vitest.node.setup.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['lcov', 'text'],
      include: [
        'packages/client-common/src/**/*.ts',
        'packages/client-node/src/**/*.ts',
      ],
      exclude: [
        'packages/**/version.ts',
        'packages/client-common/src/clickhouse_types.ts',
        'packages/client-common/src/connection.ts',
        'packages/client-common/src/result.ts',
        'packages/client-common/src/ts_utils.ts',
      ],
    },
    experimental: {
      openTelemetry: {
        enabled: process.env.VITEST_OTEL_ENABLED === 'true',
        sdkPath: './vitest.node.otel.js',
      },
    },
  },
  resolve: {
    alias: {
      '@clickhouse/client-common': 'packages/client-common/src',
      '@clickhouse/client-node': 'packages/client-node/src',
      '@test': 'packages/client-common/__tests__',
    },
  },
})
