import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'packages/client-common/__tests__/unit/*.test.ts',
      'packages/client-common/__tests__/utils/*.test.ts',
    ],
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
