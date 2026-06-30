import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { fileURLToPath } from "node:url";

// The Cloudflare Workers runner for the web client test suite. It runs exactly
// the same specs as the browser runner (packages/client-web/vitest.config.ts),
// but inside the Workers runtime (workerd) via `@cloudflare/vitest-pool-workers`
// instead of a browser via Playwright. This exercises the web client against the
// runtime real Cloudflare Workers deployments use.
//
// Embedded in the web client package, but rooted at the repo so the shared
// (common) sources and specs are reachable.
const root = fileURLToPath(new URL("../..", import.meta.url));

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
//   src  (default) - the raw TypeScript sources, for a fast, build-free loop.
//   dist           - the compiled packages, exactly as a published consumer
//                    sees them (run `npm run build` first).
// TEST_TARGET is orthogonal to TEST_MODE (which only selects the spec files).
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

// The Workers pool does not surface Vitest's `test.env` via `import.meta.env`
// (unlike the browser runner), so the connection details are passed to the
// worker as Miniflare bindings and read back in vitest.workers.setup.ts.
// Bindings must be concrete strings, so only forward variables that are set.
const bindings: Record<string, string> = {};
for (const key of [
  "CLICKHOUSE_CLOUD_HOST",
  "CLICKHOUSE_CLOUD_PASSWORD",
  "CLICKHOUSE_CLOUD_JWT_ACCESS_TOKEN",
  "CLICKHOUSE_TEST_SKIP_INIT",
  "CLICKHOUSE_TEST_ENVIRONMENT",
  "LOG_LEVEL",
]) {
  const value = process.env[key];
  if (value !== undefined) {
    bindings[key] = value;
  }
}

export default defineConfig({
  root,
  plugins: [
    cloudflareTest({
      miniflare: {
        // `nodejs_compat` provides the `process`/Node built-ins that the shared
        // test utilities and the common sources rely on.
        compatibilityDate: "2024-09-23",
        compatibilityFlags: ["nodejs_compat"],
        bindings,
      },
    }),
  ],
  test: {
    // Cover the Cloud instance wake-up time
    hookTimeout: 300_000,
    testTimeout: 300_000,
    slowTestThreshold: testMode === "unit" ? 10_000 : undefined,
    setupFiles: ["packages/client-web/vitest.workers.setup.ts"],
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
  },
  resolve: {
    // The Workers pool resolves modules through workerd and does not apply the
    // `unittest` export condition the browser runner relies on, so alias the web
    // client straight at its sources (src) or its built bundle (dist).
    alias:
      testTarget === "dist"
        ? {
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
              new URL("packages/client-web/src", `file://${root}/`),
            ),
            "@test": fileURLToPath(
              new URL("packages/client-common/__tests__", `file://${root}/`),
            ),
          },
  },
});
