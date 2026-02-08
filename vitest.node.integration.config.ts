import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Increase maxWorkers to speed up integration tests
    // as we're not bound by the CPU here.
    maxWorkers: '400%',
    globals: true,
    root: 'packages/',
    include: [
      'client-node/__tests__/integration/*.test.ts',
      'client-common/__tests__/integration/*.test.ts',
    ],
    setupFiles: ['../vitest.node.setup.ts'],
  },
  resolve: {
    alias: {
      '@clickhouse/client-common': 'client-common/src',
      '@clickhouse/client-node': 'client-node/src',
      '@test': 'client-common/__tests__',
    },
  },
})
