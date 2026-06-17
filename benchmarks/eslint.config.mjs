import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import { typescriptEslintConfig } from "../eslint.config.base.mjs";

export default defineConfig(
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
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
