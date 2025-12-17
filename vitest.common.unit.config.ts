import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    root: 'packages/client-common/__tests__',
    include: ['unit/*.test.ts', 'utils/*.test.ts'],
  },
  resolve: {
    alias: {
      '@test': '../../client-common/__tests__',
      '@clickhouse/client-common': '../../client-common/src',
      '@clickhouse/client-core': '../../client-core/src',
      '@clickhouse/client-node': '../../client-node/src',
    },
  },
})
