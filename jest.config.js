/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  ...require('./jest-base.config'),
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
}
