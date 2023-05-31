/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
const { pathsToModuleNameMapper } = require('ts-jest')
const { compilerOptions } = require('./tsconfig.dev')
module.exports = {
  preset: 'jest-puppeteer',
  clearMocks: true,
  testTimeout: 30000,
  collectCoverageFrom: ['<rootDir>/packages/**/src/**/*.ts'],
  coverageReporters: ['json-summary'],
  reporters: ['<rootDir>/jest.reporter.js'],
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths),
  modulePaths: ['<rootDir>'],
  transform: {
    '^.+\\.ts?$': [
      'ts-jest',
      /** @see https://kulshekhar.github.io/ts-jest/docs/getting-started/options/tsconfig */
      { tsconfig: './tsconfig.dev.json' },
    ],
  },
  testMatch: [
    '<rootDir>/__tests__/unit/*.test.ts',
    '<rootDir>/__tests__/unit/browser/*.test.ts',
    '<rootDir>/__tests__/integration/select.test.ts',
  ],
}
