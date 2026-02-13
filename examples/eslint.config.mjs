import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'
import { typescriptEslintConfig } from '../eslint.config.base.mjs'

export default defineConfig(
  // Base ESLint recommended rules
  js.configs.recommended,
  // TypeScript-ESLint recommended rules with type checking
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  typescriptEslintConfig(import.meta.dirname),
  {
    files: ['**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  // Ignore build artifacts and externals
  {
    ignores: [
      './__tests__/**/*.ts',
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
