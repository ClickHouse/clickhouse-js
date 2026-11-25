import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

// Real-browser post-publish e2e for @clickhouse/client-web. The published
// package is installed into this project (see the publish workflow), and
// vitest's own Vite bundler serves it to a Playwright-driven browser — exactly
// how a bundler-based web consumer would load it. This is the right runtime to
// validate the Web client: a Node host (which has both `fetch` and `node:http`)
// would not catch a browser-incompatible regression.
const browser = process.env.BROWSER ?? "chromium";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser }],
    },
  },
  // The published @clickhouse/client-web ships a CJS bundle; force Vite to
  // pre-bundle it so its named exports are exposed to the browser ESM import
  // (mirrors the main web suite's `dist` mode).
  optimizeDeps: { include: ["@clickhouse/client-web"] },
});
