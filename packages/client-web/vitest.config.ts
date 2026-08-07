import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { fileURLToPath } from "node:url";

// Embedded in the web client package, but rooted at the repo so the shared
// (common) sources and specs are reachable. The node and web packages run the
// common tests so the common code is exercised and shows up in coverage.
const root = fileURLToPath(new URL("../..", import.meta.url));

const browser = process.env.BROWSER ?? "chromium";
if (browser !== "chromium" && browser !== "firefox" && browser !== "webkit") {
  throw new Error(
    `Unsupported BROWSER: [${browser}]. Supported browsers are: chromium, firefox, webkit.`,
  );
}

const testMode = process.env.TEST_MODE;
if (
  testMode !== "unit" &&
  testMode !== "integration" &&
  testMode !== "jwt" &&
  testMode !== "all"
) {
  throw new Error(
    `Unsupported TEST_MODE: [${testMode}]. Supported modes are: unit, integration, jwt, all.`,
  );
}

// Which build of the client the `@clickhouse/*` specifiers resolve to:
//   src  (default) - the raw TypeScript sources (via the `unittest` export
//                    condition), for a fast, build-free loop.
//   dist           - the compiled packages, exactly as a published consumer
//                    sees them (run `npm run build` first). An e2e-style guard
//                    against the built artifact / public surface.
// TEST_TARGET is orthogonal to TEST_MODE (which only selects the spec files).
// Caveat: only specs that import EXCLUSIVELY via the `@clickhouse/*` names
// retarget cleanly; specs that also reach into `../../src` directly keep
// importing source for those paths regardless.
const testTarget = process.env.TEST_TARGET ?? "src";
if (testTarget !== "src" && testTarget !== "dist") {
  throw new Error(
    `Unsupported TEST_TARGET: [${testTarget}]. Supported targets are: src, dist.`,
  );
}

const collections = {
  unit: [
    "packages/client-common/__tests__/unit/*.test.ts",
    "packages/client-common/__tests__/utils/*.test.ts",
    "packages/client-web/__tests__/unit/*.test.ts",
  ],
  integration: [
    "packages/client-common/__tests__/integration/*.test.ts",
    "packages/client-web/__tests__/integration/*.test.ts",
  ],
  // JWT tests require a specific environment setup (a valid access token)
  // This list is integration + JWT tests
  jwt: [
    "packages/client-common/__tests__/integration/*.test.ts",
    "packages/client-web/__tests__/integration/*.test.ts",
    "packages/client-web/__tests__/jwt/*.test.ts",
  ],
  all: [
    "packages/client-common/__tests__/unit/*.test.ts",
    "packages/client-common/__tests__/utils/*.test.ts",
    "packages/client-common/__tests__/integration/*.test.ts",
    "packages/client-web/__tests__/unit/*.test.ts",
    "packages/client-web/__tests__/integration/*.test.ts",
    "packages/client-web/__tests__/jwt/*.test.ts",
  ],
};

export default defineConfig({
  root,
  test: {
    // Increase maxWorkers to speed up integration tests
    // as we're not bound by the CPU here.
    maxWorkers: "400%",
    // Cover the Cloud instance wake-up time
    hookTimeout: 300_000,
    testTimeout: 300_000,
    slowTestThreshold: testMode === "unit" ? 10_000 : undefined,
    setupFiles: ["packages/client-web/vitest.setup.ts"],
    include: collections[testMode],
    coverage: {
      enabled: process.env.VITEST_COVERAGE === "true",
      provider: "istanbul",
      reporter: ["lcov", "text"],
      include: [
        "packages/client-common/src/**/*.ts",
        "packages/client-web/src/**/*.ts",
      ],
      exclude: [
        "packages/**/version.ts",
        "packages/client-common/src/clickhouse_types.ts",
        "packages/client-common/src/connection.ts",
        "packages/client-common/src/result.ts",
        "packages/client-common/src/ts_utils.ts",
        "packages/client-common/__tests__/utils/*.ts",
      ],
    },
    env: {
      CLICKHOUSE_CLOUD_HOST: process.env.CLICKHOUSE_CLOUD_HOST,
      CLICKHOUSE_CLOUD_PASSWORD: process.env.CLICKHOUSE_CLOUD_PASSWORD,
      CLICKHOUSE_CLOUD_JWT_ACCESS_TOKEN:
        process.env.CLICKHOUSE_CLOUD_JWT_ACCESS_TOKEN,
      CLICKHOUSE_TEST_SKIP_INIT: process.env.CLICKHOUSE_TEST_SKIP_INIT,
      CLICKHOUSE_TEST_ENVIRONMENT: process.env.CLICKHOUSE_TEST_ENVIRONMENT,
      OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
      OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      OTEL_EXPORTER_OTLP_HEADERS: process.env.OTEL_EXPORTER_OTLP_HEADERS,

      GITHUB_SHA: process.env.GITHUB_SHA,
      GITHUB_RUN_ID: process.env.GITHUB_RUN_ID,
      GITHUB_JOB_NAME: process.env.GITHUB_JOB_NAME,
      GITHUB_WORKFLOW: process.env.GITHUB_WORKFLOW,
    },
    experimental: {
      openTelemetry: {
        enabled:
          process.env.VITEST_OTEL_ENABLED === "true" &&
          // not set in dependabot PRs
          !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        sdkPath: "./packages/client-node/vitest.otel.js",
        // According to testing, runners hang indefinitely when OTEL is enabled in browser tests,
        // and when they don't the exporter visibly slows the tests down (2x-5x).
        // Tests also crash (their iframe?) when the devtools are open in Chrome.
        // browserSdkPath: './packages/client-web/vitest.otel.js',
      },
    },
    browser: {
      enabled: true,
      // Run headless by default so the test runner never pops up a browser
      // window (locally Vitest would otherwise launch a headed browser; it only
      // defaults to headless in CI). Set BROWSER_HEADED=true to opt back into a
      // visible browser, e.g. for debugging.
      headless: process.env.BROWSER_HEADED !== "true",
      provider: playwright(),
      instances: [{ browser }],
    },
  },
  // In `dist` mode the web client resolves to its published CJS bundle; force
  // Vite to pre-bundle it (as a real bundler-based consumer would) so its named
  // exports are exposed to the browser ESM imports.
  optimizeDeps:
    testTarget === "dist" ? { include: ["@clickhouse/client-web"] } : undefined,
  resolve: {
    // Driven by TEST_TARGET (see above). With `src` (default), the `unittest`
    // export condition + aliases resolve the raw sources. With `dist`, we drop
    // them so the published `default` export (dist/index.js) and the
    // node_modules workspace symlinks resolve to the BUILT packages (run
    // `npm run build` first).
    conditions: testTarget === "dist" ? [] : ["unittest"],
    // Under `dist`, both client specifiers resolve to the web client's own
    // bundle. The web client bundles the common sources (client-common is
    // deprecated and not a runtime dep), so a real consumer gets common-origin
    // symbols — value classes like `SettingsMap`/`TupleParam`, `ClickHouseError`
    // — from `@clickhouse/client-web`. Pointing both at one bundle keeps a
    // single class identity, so `instanceof` checks (the client's internal ones
    // on test-provided values, and the tests' own) hold.
    alias:
      testTarget === "dist"
        ? {
            // Redirect the deprecated common package NAME to the web client
            // package NAME (not a path) so it resolves through the published
            // entry — Vite pre-bundles the CJS dist and its named exports stay
            // intact, and common-origin symbols share the client's one bundle.
            "@clickhouse/client-common": "@clickhouse/client-web",
            "@test": fileURLToPath(
              new URL("packages/client-common/__tests__", `file://${root}/`),
            ),
          }
        : {
            "@clickhouse/client-common": fileURLToPath(
              new URL("packages/client-common/src", `file://${root}/`),
            ),
            "@clickhouse/client-web": fileURLToPath(
              new URL("packages/client-web", `file://${root}/`),
            ),
            "@test": fileURLToPath(
              new URL("packages/client-common/__tests__", `file://${root}/`),
            ),
          },
  },
});
