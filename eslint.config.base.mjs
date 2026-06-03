import pluginPrettier from 'eslint-plugin-prettier'
import pluginExpectType from 'eslint-plugin-expect-type/configs/recommended'

export function typescriptEslintConfig(root) {
  return {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: root,
      },
    },
    plugins: {
      prettier: pluginPrettier,
      'expect-type': pluginExpectType,
    },
    rules: {
      'prettier/prettier': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      eqeqeq: 'error',
      'no-console': 'error',
      // Keep some rules relaxed until addressed in dedicated PRs
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/array-type': 'off',
    },
  } // TypeScript-ESLint recommended rules with type checking
}

export function testFilesOverrides() {
  // Test files overrides
  return {
    files: ['./**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      'no-constant-condition': 'off',
      'no-console': 'off',
    },
  }
}
