/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  testEnvironment: 'node',
  preset: 'ts-jest',
  clearMocks: true,
  collectCoverageFrom: ['<rootDir>/src/**/*.ts'],
  testMatch: ['<rootDir>/__tests__/**/*.test.{js,mjs,ts,tsx}'],
  testTimeout: 30000,
  coverageReporters: ['json-summary'],
  reporters: ['<rootDir>/jest.reporter.js'],
}
