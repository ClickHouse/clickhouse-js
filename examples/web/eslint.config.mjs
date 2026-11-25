import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import pluginExpectType from "eslint-plugin-expect-type/configs/recommended";

// Report every ESLint rule as a warning; only the TypeScript compiler
// (`npm run typecheck`) should produce hard errors.
function onlyWarn(configs) {
  return configs.map((config) => {
    if (!config.rules) {
      return config;
    }
    const rules = {};
    for (const [name, value] of Object.entries(config.rules)) {
      const severity = Array.isArray(value) ? value[0] : value;
      if (severity === "error" || severity === 2) {
        rules[name] = Array.isArray(value)
          ? ["warn", ...value.slice(1)]
          : "warn";
      } else {
        rules[name] = value;
      }
    }
    return { ...config, rules };
  });
}

export default defineConfig(
  // Recommended rule sets, downgraded to warnings (only tsc reports errors)
  ...onlyWarn([
    js.configs.recommended,
    ...tseslint.configs.strict,
    ...tseslint.configs.stylistic,
  ]),
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
      "@typescript-eslint/no-floating-promises": "warn",
      eqeqeq: "warn",
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
