/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
const { pathsToModuleNameMapper } = require('ts-jest')
const { compilerOptions } = require('./tsconfig.dev')
module.exports = {
  testEnvironment: 'node',
  preset: 'ts-jest',
  clearMocks: true,
  collectCoverageFrom: ['<rootDir>/packages/**/src/**/*.ts'],
  testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
  testTimeout: 30000,
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
}
