import { defineConfig } from "eslint/config";
import {
  recommendedWarnConfigs,
  typescriptEslintConfig,
} from "../../eslint.config.base.mjs";

export default defineConfig(
  // Recommended rule sets, downgraded to warnings (only tsc reports errors)
  ...recommendedWarnConfigs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
    },
  },
  typescriptEslintConfig(import.meta.dirname),
  // Ignore build artifacts and externals
  {
    ignores: [
      "./__tests__/**/*.ts",
      "eslint.config.mjs",
      "vitest.config.ts",
      "vitest.setup.ts",
      "vitest.otel.js",
      "coverage",
      "out",
      "dist",
      "node_modules",
      "webpack",
    ],
  },
);
