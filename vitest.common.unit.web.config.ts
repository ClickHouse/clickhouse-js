import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

const browser = process.env.BROWSER ?? 'chromium'
if (browser !== 'chromium' && browser !== 'firefox' && browser !== 'webkit') {
  throw new Error(
    `Unsupported browser for tests: [${browser}]. Supported browsers are: chromium, firefox, webkit.`,
  )
}

export default defineConfig({
  test: {
    root: 'packages/client-common/__tests__',
    include: ['unit/*.test.ts', 'utils/*.test.ts'],
    browser: {
      enabled: true,
      provider: playwright(),
      // https://vitest.dev/config/browser/playwright
      instances: [{ browser }],
    },
  },
  resolve: {
    alias: {
      '@clickhouse/client-common': '../../client-common/src',
    },
  },
})
