const { defaults: tsjPreset } = require('ts-jest/presets')

/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  testEnvironment: 'node',
  preset: 'ts-jest',
  clearMocks: true,
  collectCoverageFrom: ['<rootDir>/src/**/*.ts'],
  testMatch: ['**/*.test.{js,mjs,ts,tsx}'],
  transform: tsjPreset.transform,
  testTimeout: 30000,
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.eslint.json',
    },
  },
}
