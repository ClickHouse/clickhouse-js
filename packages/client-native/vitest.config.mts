import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Rooted at the repo, as the node client config: the specs read the TLS
// certificates with repo-root-relative paths.
const root = fileURLToPath(new URL("../..", import.meta.url));
process.chdir(root);

const testMode = process.env.TEST_MODE;
const collections: Record<string, string[]> = {
  unit: ["packages/client-native/__tests__/unit/*.test.ts"],
  integration: ["packages/client-native/__tests__/integration/*.test.ts"],
  tls: ["packages/client-native/__tests__/tls/*.test.ts"],
  all: [
    "packages/client-native/__tests__/unit/*.test.ts",
    "packages/client-native/__tests__/integration/*.test.ts",
    "packages/client-native/__tests__/tls/*.test.ts",
  ],
};
const include = testMode === undefined ? undefined : collections[testMode];
if (include === undefined) {
  throw new Error(
    `Unsupported TEST_MODE: [${testMode}]. Supported modes are: ${Object.keys(collections).join(", ")}.`,
  );
}

export default defineConfig({
  root,
  test: {
    hookTimeout: 60_000,
    testTimeout: 60_000,
    include,
    coverage: {
      include: ["packages/client-native/src/**/*.ts"],
      // Vitest follows the common-source symlink in the include glob but
      // records runtime coverage under the real path. The HTTP suites report
      // common-source coverage separately.
      exclude: ["packages/client-native/src/common/**"],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage/client-native",
    },
  },
});
