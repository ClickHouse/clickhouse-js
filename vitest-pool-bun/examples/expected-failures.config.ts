import { defineBunPoolConfig } from '../dist/index.js'

// Separate config so the intentionally-failing fixture is never part of the
// green demo suite. Used to demonstrate failure reporting (STOP gate 2).
export default defineBunPoolConfig({
  test: {
    root: __dirname,
    include: ['expected-failures/**/*.test.ts'],
    watch: false,
  },
})
