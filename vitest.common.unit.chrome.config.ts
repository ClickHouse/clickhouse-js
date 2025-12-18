import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  test: {
    root: 'packages/client-common/__tests__',
    include: ['unit/*.test.ts', 'utils/*.test.ts'],
    browser: {
      enabled: true,
      provider: playwright(),
      // https://vitest.dev/config/browser/playwright
      instances: [{ browser: 'chromium' }],
    },
  },
  resolve: {
    alias: {
      '@clickhouse/client-common': '../../client-common/src',
    },
  },
})
