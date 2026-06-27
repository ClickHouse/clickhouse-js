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
    // The CLI entry point and the test/snapshot/oracle/bench harnesses are
    // scripts that legitimately write to stdout/stderr.
    files: ["tool/**/*.ts", "test/**/*.ts", "bench/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // reference-cpp-extracted-parser is the C++ source this library was ported
    // from; it has no lintable TypeScript, and its CMake build/ tree generates
    // `compiler_depend.ts` timestamp files that are not real TS.
    ignores: [
      "dist",
      "node_modules",
      "eslint.config.mjs",
      "reference-cpp-extracted-parser",
    ],
  },
);
