import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Increase maxWorkers to speed up integration tests
    // as we're not bound by the CPU here.
    maxWorkers: '400%',
    globals: true,
    include: ['packages/client-node/__tests__/tls/*.test.ts'],
    setupFiles: ['vitest.node.setup.ts'],
    coverage: {
      provider: 'istanbul',
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
