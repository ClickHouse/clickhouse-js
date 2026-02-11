import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import { fileURLToPath } from 'node:url'

const browser = process.env.BROWSER ?? 'chromium'
if (browser !== 'chromium' && browser !== 'firefox' && browser !== 'webkit') {
  throw new Error(
    `Unsupported browser for tests: [${browser}]. Supported browsers are: chromium, firefox, webkit.`,
  )
}

export default defineConfig({
  test: {
    setupFiles: ['vitest.web.setup.ts'],
    include: [
      'packages/client-common/__tests__/unit/*.test.ts',
      'packages/client-common/__tests__/utils/*.test.ts',
    ],
    browser: {
      enabled: true,
      provider: playwright(),
      // https://vitest.dev/config/browser/playwright
      instances: [{ browser }],
    },
    coverage: {
      provider: 'istanbul',
    },
  },
  resolve: {
    // Use the unittest entry point to get the source files instead of built files
    conditions: ['unittest'],
    alias: {
      '@clickhouse/client-common': fileURLToPath(
        new URL('./packages/client-common/src', import.meta.url),
      ),
      '@clickhouse/client-web': fileURLToPath(
        new URL('./packages/client-web', import.meta.url),
      ),
      '@test': fileURLToPath(
        new URL('./packages/client-common/__tests__', import.meta.url),
      ),
    },
  },
})
