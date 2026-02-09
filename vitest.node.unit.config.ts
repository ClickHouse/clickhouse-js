import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'packages/client-node/__tests__/unit/*.test.ts',
      'packages/client-node/__tests__/utils/*.test.ts',
    ],
    coverage: {
      provider: 'istanbul',
    },
  },
  resolve: {
    alias: {
      '@clickhouse/client-common': 'packages/client-common/src',
    },
  },
})
