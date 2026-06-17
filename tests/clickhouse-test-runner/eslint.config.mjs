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
    ignores: ["dist", "node_modules", "bin", "eslint.config.mjs"],
  },
);
