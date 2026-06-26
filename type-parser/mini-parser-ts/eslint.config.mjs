import { defineConfig } from "eslint/config";
import {
  recommendedWarnConfigs,
  typescriptEslintConfig,
  testFilesOverrides,
} from "../../eslint.config.base.mjs";

export default defineConfig(
  // Recommended rule sets, downgraded to warnings (only tsc reports errors)
  ...recommendedWarnConfigs,
  typescriptEslintConfig(import.meta.dirname),
  testFilesOverrides(),
  {
    // src/ is a faithful, line-by-line port of the C++ `chdt` library whose
    // control flow deliberately tracks the original (see the header comment in
    // src/parser.ts). Index-based loops are intentional parity with the C++
    // sources, not something to rewrite into for-of.
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/prefer-for-of": "off",
    },
  },
  {
    // The CLI entry point and the test/snapshot/oracle harness are scripts that
    // legitimately write to stdout/stderr.
    files: ["tool/**/*.ts", "test/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    ignores: ["dist", "node_modules", "eslint.config.mjs"],
  },
);
