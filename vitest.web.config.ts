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
    // Increase maxWorkers to speed up integration tests
    // as we're not bound by the CPU here.
    maxWorkers: '400%',
    // Cover the Cloud instance wake-up time
    testTimeout: 300_000,
    slowTestThreshold: 10_000,
    globals: true,
    setupFiles: ['vitest.web.setup.ts'],
    // include: ['unit/*.test.ts', 'utils/*.test.ts'],
    include: [
      'packages/client-common/__tests__/utils/*.test.ts',
      'packages/client-common/__tests__/integration/*.test.ts',
      'packages/client-web/__tests__/integration/*.test.ts',
      'packages/client-web/__tests__/unit/*.test.ts',
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
