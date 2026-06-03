import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'
import {
  typescriptEslintConfig,
  testFilesOverrides,
} from '../../eslint.config.base.mjs'

export default defineConfig(
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  typescriptEslintConfig(import.meta.dirname),
  testFilesOverrides(),
  {
    ignores: ['dist', 'node_modules', 'bin', 'eslint.config.mjs'],
  },
)
