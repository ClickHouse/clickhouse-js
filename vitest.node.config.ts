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
  // Unlike the other (fast, build-free) modes, these are e2e-style guards: they
  // import the public package names and resolve to the BUILT workspace packages
  // (see the resolve.alias note below), so a breaking change in the published
  // surface fails the matching consumer's test. `npm run build` must run first.
  // See packages/client-node/__tests__/oss-dependents.
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
    // The oss-dependents specs import the published package names (`@clickhouse/
    // client`, `-web`, `-common`) exactly as the upstream dependents do; those
    // resolve through the node_modules workspace symlinks to the BUILT packages
    // (run `npm run build` first) — an e2e-style guard against the published
    // surface rather than `src`. `@clickhouse/client-node` is not a real package
    // name (the node client publishes as `@clickhouse/client`); it is an
    // internal alias the shared node setup/util files import, so we repoint it
    // at the built node `dist` for this mode. Every other mode aliases the
    // workspace `src` instead for a fast, build-free unit/integration loop.
    alias:
      testMode === "oss-dependents"
        ? {
            "@clickhouse/client-node": "packages/client-node/dist",
            "@test": "packages/client-common/__tests__",
          }
        : {
            "@clickhouse/client-common": "packages/client-common/src",
            "@clickhouse/client-node": "packages/client-node/src",
            "@test": "packages/client-common/__tests__",
          },
  },
});
