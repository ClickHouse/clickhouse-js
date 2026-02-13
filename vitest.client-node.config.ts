import { defineConfig } from 'vitest/config'

const testMode = process.env.TEST_MODE ?? 'unit'

// Base configuration for all client-node tests
const baseResolve = {
  alias: {
    '@clickhouse/client-common': 'packages/client-common/src',
    '@clickhouse/client-node': 'packages/client-node/src',
    '@test': 'packages/client-common/__tests__',
  },
}

// Configuration for unit tests
const unitConfig = defineConfig({
  test: {
    include: [
      'packages/client-node/__tests__/unit/*.test.ts',
      'packages/client-node/__tests__/utils/*.test.ts',
    ],
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
  resolve: baseResolve,
})

// Configuration for integration tests
const integrationConfig = defineConfig({
  test: {
    // Increase maxWorkers to speed up integration tests
    // as we're not bound by the CPU here.
    maxWorkers: '400%',
    // Cover the Cloud instance wake-up time
    testTimeout: 300_000,
    slowTestThreshold: 10_000,
    include: [
      'packages/client-node/__tests__/integration/*.test.ts',
      'packages/client-common/__tests__/integration/*.test.ts',
    ],
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
  resolve: baseResolve,
})

// Configuration for TLS tests
const tlsConfig = defineConfig({
  test: {
    // Increase maxWorkers to speed up integration tests
    // as we're not bound by the CPU here.
    maxWorkers: '400%',
    // Cover the Cloud instance wake-up time
    testTimeout: 300_000,
    slowTestThreshold: 10_000,
    include: ['packages/client-node/__tests__/tls/*.test.ts'],
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
  resolve: baseResolve,
})

// Configuration for all tests (unit + integration + TLS)
const allConfig = defineConfig({
  test: {
    // Increase maxWorkers to speed up integration tests
    // as we're not bound by the CPU here.
    maxWorkers: '400%',
    // Cover the Cloud instance wake-up time
    testTimeout: 300_000,
    slowTestThreshold: 10_000,
    include: [
      'packages/client-common/__tests__/unit/*.test.ts',
      'packages/client-common/__tests__/utils/*.test.ts',
      'packages/client-common/__tests__/integration/*.test.ts',
      'packages/client-node/__tests__/tls/*.test.ts',
      'packages/client-node/__tests__/unit/*.test.ts',
      'packages/client-node/__tests__/utils/*.test.ts',
      'packages/client-node/__tests__/integration/*.test.ts',
    ],
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
  },
  resolve: baseResolve,
})

// Export the appropriate config based on TEST_MODE
export default testMode === 'integration'
  ? integrationConfig
  : testMode === 'tls'
    ? tlsConfig
    : testMode === 'all'
      ? allConfig
      : unitConfig
