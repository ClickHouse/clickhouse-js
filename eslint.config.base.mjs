import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginExpectType from "eslint-plugin-expect-type/configs/recommended";

// Every ESLint rule is reported as a warning rather than an error: the only hard
// errors in the pipeline should come from the TypeScript compiler (`npm run
// typecheck`). CI still runs `eslint --max-warnings=0`, so warnings keep failing
// the build, they just are not labelled as ESLint "errors".
export function onlyWarn(configs) {
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

// Shared recommended rule sets, downgraded so that nothing is an error.
export const recommendedWarnConfigs = onlyWarn([
  // Base ESLint recommended rules
  js.configs.recommended,
  // TypeScript-ESLint recommended rules with type checking
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
]);

export function typescriptEslintConfig(root) {
  return {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: root,
      },
    },
    plugins: {
      "expect-type": pluginExpectType,
    },
    rules: {
      // Reported as warnings on purpose: only `tsc` should produce errors.
      "@typescript-eslint/no-floating-promises": "warn",
      eqeqeq: "warn",
      "no-console": "warn",
      // Keep some rules relaxed until addressed in dedicated PRs
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/consistent-type-imports": "warn",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  }; // TypeScript-ESLint recommended rules with type checking
}

export function testFilesOverrides() {
  // Test files overrides
  return {
    files: ["./**/__tests__/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-constant-condition": "off",
      "no-console": "off",
    },
  };
}
