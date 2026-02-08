import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    root: 'packages/',
    include: [
      'client-node/__tests__/integration/*.test.ts',
      'client-common/__tests__/integration/*.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@clickhouse/client-common': 'client-common/src',
      '@test': 'client-common/__tests__',
    },
  },
})
