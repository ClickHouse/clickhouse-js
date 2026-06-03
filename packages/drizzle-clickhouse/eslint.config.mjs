import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'
import { typescriptEslintConfig } from '../../eslint.config.base.mjs'

export default defineConfig(
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
    },
  },
  typescriptEslintConfig(import.meta.dirname),
  {
    ignores: [
      './__tests__/**/*.ts',
      'eslint.config.mjs',
      'coverage',
      'out',
      'dist',
      'node_modules',
    ],
  },
)
