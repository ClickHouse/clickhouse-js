const { pathsToModuleNameMapper } = require('ts-jest')
const { compilerOptions } = require('./tsconfig.dev')

/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  preset: 'ts-jest',
  clearMocks: true,
  testTimeout: 30000,
  collectCoverageFrom: ['<rootDir>/packages/**/src/**/*.ts'],
  coverageReporters: ['json-summary'],
  reporters: ['<rootDir>/jest.reporter.js'],
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths),
  modulePaths: ['<rootDir>'],
  unmockedModulePathPatterns: ['jasmine'],
  transform: {
    '^.+\\.ts?$': [
      'ts-jest',
      /** @see https://kulshekhar.github.io/ts-jest/docs/getting-started/options/tsconfig */
      { tsconfig: './tsconfig.dev.json' },
    ],
  },
  setupFilesAfterEnv: ['']
}
