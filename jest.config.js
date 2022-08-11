const { defaults: tsjPreset } = require('ts-jest/presets');

/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  testEnvironment: 'node',
  clearMocks: true,
  collectCoverageFrom: ['<rootDir>/src/**/*.ts'],
  transform: tsjPreset.transform,
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.eslint.json',
    },
  },
};
