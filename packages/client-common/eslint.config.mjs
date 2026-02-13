import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import pluginPrettier from 'eslint-plugin-prettier'
import pluginExpectType from 'eslint-plugin-expect-type/configs/recommended'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  // Base ESLint recommended rules
  js.configs.recommended,
  // TypeScript-ESLint recommended rules with type checking
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  // Enable type-aware linting for TypeScript files only
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        // todo
      },
    },
  },
  // Project-wide rules and plugins
  {
    plugins: {
      // prettier: pluginPrettier,
      'expect-type': pluginExpectType,
    },
    rules: {
      // 'prettier/prettier': 'error',
      // '@typescript-eslint/no-floating-promises': 'error',
      // eqeqeq: 'error',
      // 'no-console': 'error',
      // // Keep some rules relaxed until addressed in dedicated PRs
      '@typescript-eslint/no-explicit-any': 'off',
      // '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/array-type': 'off',
    },
  },
  // Test files overrides
  {
    files: ['./**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      'no-constant-condition': 'off',
      'no-console': 'off',
    },
  },
  // Ignore build artifacts and externals
  {
    ignores: [
      'eslint.config.mjs',
      'vitest.*.config.ts',
      'vitest.*.setup.ts',
      'coverage',
      'out',
      'dist',
      'node_modules',
      'webpack',
    ],
  },
)
