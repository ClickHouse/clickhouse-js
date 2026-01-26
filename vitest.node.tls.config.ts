import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    root: 'packages/client-node/__tests__',
    include: ['tls/*.test.ts'],
  },
  resolve: {
    alias: {
      '@clickhouse/client-common': '../../client-common/src',
      '@test': '../../client-common/__tests__',
    },
  },
})
