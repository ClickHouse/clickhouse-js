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

// Which build of the client the `@clickhouse/*` specifiers resolve to:
//   src  (default) - the raw TypeScript sources, for a fast, build-free loop.
//   dist           - the compiled packages, exactly as a published consumer
//                    sees them (run `npm run build` first). An e2e-style guard
//                    against the built artifact / public surface.
// TEST_TARGET is orthogonal to TEST_MODE (which only selects the spec files),
// so e.g. `TEST_TARGET=dist TEST_MODE=integration` runs the integration specs
// against the built packages. Caveat: only specs that import EXCLUSIVELY via
// the `@clickhouse/*` names retarget cleanly; specs that also reach into
// `../../src` directly (most unit/integration specs do) keep importing source
// for those paths regardless. The `oss-dependents` collection imports only the
// published names, so it is a true built-surface guard and defaults to `dist`.
const testTarget =
  process.env.TEST_TARGET ?? (testMode === "oss-dependents" ? "dist" : "src");
if (testTarget !== "src" && testTarget !== "dist") {
  throw new Error(
    `Unsupported TEST_TARGET: [${testTarget}]. Supported targets are: src, dist.`,
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
  // These specs import only the public package names, so they default to
  // TEST_TARGET=dist (see above) and resolve to the BUILT workspace packages:
  // a breaking change in the published surface fails the matching consumer's
  // test. `npm run build` must run first. See
  // packages/client-node/__tests__/oss-dependents.
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
    // Driven by TEST_TARGET (see above). With `dist`, the published package
    // names (`@clickhouse/client`, `-web`, `-common`) resolve through the
    // node_modules workspace symlinks to the BUILT packages (run `npm run build`
    // first) — an e2e-style guard against the published surface. With `src`,
    // they alias the workspace sources for a fast, build-free loop.
    // `@clickhouse/client-node` is not a real package name (the node client
    // publishes as `@clickhouse/client`); it is an internal alias the shared
    // node setup/util files import, so under `dist` we repoint it at the built
    // node `dist`.
    //
    // Under `dist`, the node and common specifiers aliased below
    // (`@clickhouse/client`, `@clickhouse/client-common`, and the internal
    // `@clickhouse/client-node`) all resolve to the node client's own bundle.
    // The node client bundles the common sources (client-common is deprecated
    // and not a runtime dep), so a real consumer gets common-origin symbols —
    // `ClickHouseError`, value classes like `SettingsMap`/`TupleParam` — from
    // `@clickhouse/client`, not from a separate `client-common`. Pointing them
    // at one bundle keeps a single class identity, so the client's internal
    // `instanceof` checks on test-provided values (and the tests' own
    // `instanceof` assertions) hold. (`@clickhouse/client-web`, imported by the
    // oss-dependents suite, is not aliased here — it resolves through
    // node_modules to the web client's own dist.)
    alias:
      testTarget === "dist"
        ? {
            "@clickhouse/client": "packages/client-node/dist",
            "@clickhouse/client-common": "packages/client-node/dist",
            "@clickhouse/client-node": "packages/client-node/dist",
            "@test": "packages/client-common/__tests__",
          }
        : {
            // The published node name, imported by the integration specs.
            "@clickhouse/client": "packages/client-node/src",
            "@clickhouse/client-common": "packages/client-common/src",
            "@clickhouse/client-node": "packages/client-node/src",
            "@test": "packages/client-common/__tests__",
          },
  },
});
