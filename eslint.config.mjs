import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import { typescriptEslintConfig } from './eslint.config.base.mjs'
import { fileURLToPath } from 'node:url'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  typescriptEslintConfig(fileURLToPath(new URL('.', import.meta.url))),
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'packages/**',
      'examples/**',
      'benchmarks/**',
    ],
  },
)
