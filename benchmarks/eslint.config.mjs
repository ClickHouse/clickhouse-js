import { defineConfig } from "eslint/config";
import {
  recommendedWarnConfigs,
  typescriptEslintConfig,
} from "../eslint.config.base.mjs";

export default defineConfig(
  // Recommended rule sets, downgraded to warnings (only tsc reports errors)
  ...recommendedWarnConfigs,
  typescriptEslintConfig(import.meta.dirname),
  {
    // Benchmarks are standalone scripts that intentionally print to stdout.
    rules: {
      "no-console": "off",
    },
  },
  {
    ignores: ["dist", "node_modules", "eslint.config.mjs"],
  },
);
