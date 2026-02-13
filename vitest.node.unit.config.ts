import { defineConfig } from 'vitest/config'

export default defineConfig({
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
  resolve: {
    alias: {
      '@clickhouse/client-common': 'packages/client-common/src',
      '@clickhouse/client-node': 'packages/client-node/src',
      '@test': 'packages/client-common/__tests__',
    },
  },
})
