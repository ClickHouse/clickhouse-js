import { defineConfig } from "vitest/config";

const testMode = process.env.TEST_MODE;
if (
  testMode !== "unit" &&
  testMode !== "integration" &&
  testMode !== "tls" &&
  testMode !== "common" &&
  testMode !== "common-integration" &&
  testMode !== "oss-dependents" &&
  testMode !== "all"
) {
  throw new Error(
    `Unsupported TEST_MODE: [${testMode}]. Supported modes are: unit, integration, tls, common, common-integration, oss-dependents, all.`,
  );
}

const collections = {
  unit: [
    "packages/client-node/__tests__/unit/*.test.ts",
    "packages/client-node/__tests__/utils/*.test.ts",
  ],
  integration: [
    "packages/client-node/__tests__/integration/*.test.ts",
    "packages/client-common/__tests__/integration/*.test.ts",
  ],
  // TLS tests require a specific environment setup
  // This list is integration + TLS tests
  tls: [
    "packages/client-node/__tests__/integration/*.test.ts",
    "packages/client-common/__tests__/integration/*.test.ts",
    "packages/client-node/__tests__/tls/*.test.ts",
  ],
  common: [
    "packages/client-common/__tests__/unit/*.test.ts",
    "packages/client-common/__tests__/utils/*.test.ts",
  ],
  "common-integration": [
    "packages/client-common/__tests__/integration/*.test.ts",
  ],
  // Runnable reproductions of how the top OSS dependents use the client.
  // Each spec exercises a real dependent's surface against the workspace source
  // (via the @clickhouse/client* aliases below) so a breaking change here fails
  // the matching consumer's test. See packages/client-node/__tests__/oss-dependents.
  "oss-dependents": ["packages/client-node/__tests__/oss-dependents/*.test.ts"],
  all: [
    "packages/client-common/__tests__/unit/*.test.ts",
    "packages/client-common/__tests__/utils/*.test.ts",
    "packages/client-common/__tests__/integration/*.test.ts",
    "packages/client-node/__tests__/tls/*.test.ts",
    "packages/client-node/__tests__/unit/*.test.ts",
    "packages/client-node/__tests__/utils/*.test.ts",
    "packages/client-node/__tests__/integration/*.test.ts",
    "packages/client-node/__tests__/oss-dependents/*.test.ts",
  ],
};

export default defineConfig({
  test: {
    // Increase maxWorkers to speed up integration tests
    // as we're not bound by the CPU here.
    maxWorkers: "400%",
    // Cover the Cloud instance wake-up time
    hookTimeout: 300_000,
    testTimeout: 300_000,
    slowTestThreshold: testMode === "unit" ? 10_000 : undefined,
    setupFiles: ["vitest.node.setup.ts"],
    include: collections[testMode],
    coverage: {
      enabled: process.env.VITEST_COVERAGE === "true",
      provider: "istanbul",
      reporter: ["lcov", "text"],
      include: [
        "packages/client-common/src/**/*.ts",
        "packages/client-node/src/**/*.ts",
      ],
      exclude: [
        "packages/**/version.ts",
        "packages/client-common/src/clickhouse_types.ts",
        "packages/client-common/src/connection.ts",
        "packages/client-common/src/result.ts",
        "packages/client-common/src/ts_utils.ts",
      ],
    },
    env: {
      CLICKHOUSE_CLOUD_HOST: process.env.CLICKHOUSE_CLOUD_HOST,
      CLICKHOUSE_CLOUD_PASSWORD: process.env.CLICKHOUSE_CLOUD_PASSWORD,
      CLICKHOUSE_CLOUD_JWT_ACCESS_TOKEN:
        process.env.CLICKHOUSE_CLOUD_JWT_ACCESS_TOKEN,
      CLICKHOUSE_TEST_SKIP_INIT: process.env.CLICKHOUSE_TEST_SKIP_INIT,
      CLICKHOUSE_TEST_ENVIRONMENT: process.env.CLICKHOUSE_TEST_ENVIRONMENT,
    },
    experimental: {
      openTelemetry: {
        enabled:
          process.env.VITEST_OTEL_ENABLED === "true" &&
          // not set in dependabot PRs
          !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        sdkPath: "./vitest.node.otel.js",
      },
    },
    retry: process.env.CI ? 2 : 0,
  },
  resolve: {
    alias: {
      "@clickhouse/client-common": "packages/client-common/src",
      "@clickhouse/client-node": "packages/client-node/src",
      // The oss-dependents specs import from the public package names exactly as
      // the upstream dependents do; alias them to the workspace source so those
      // tests guard breaking changes against `src` (not the published packages).
      // @rollup/plugin-alias only matches on an exact key or `key + "/"`, so
      // these do NOT shadow `@clickhouse/client-common` / `-node` / `-web`.
      "@clickhouse/client": "packages/client-node/src",
      "@clickhouse/client-web": "packages/client-web/src",
      "@test": "packages/client-common/__tests__",
    },
  },
});
