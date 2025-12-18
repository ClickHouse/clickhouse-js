import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    root: 'packages/client-common/__tests__',
    include: ['unit/*.test.ts', 'utils/*.test.ts'],
  },
  resolve: {
    alias: {
      '@clickhouse/client-common': '../../client-common/src',
    },
  },
})
