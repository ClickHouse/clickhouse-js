import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import pluginExpectType from "eslint-plugin-expect-type/configs/recommended";

export default defineConfig(
  // Base ESLint recommended rules
  js.configs.recommended,
  // TypeScript-ESLint recommended rules with type checking
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "expect-type": pluginExpectType,
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      eqeqeq: "error",
      // Keep some rules relaxed until addressed in dedicated PRs
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/consistent-type-imports": "warn",
      "@typescript-eslint/array-type": "off",
    },
  },
  {
    files: ["**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  // Ignore build artifacts and externals
  {
    ignores: [
      "eslint.config.mjs",
      "vitest.config.ts",
      "vitest.setup.ts",
      "coverage",
      "out",
      "dist",
      "node_modules",
    ],
  },
);
