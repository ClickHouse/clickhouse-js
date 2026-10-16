import { defineBunPoolConfig } from '../dist/index.js'

// Separate config so the crash fixture is never picked up by the demo suite.
export default defineBunPoolConfig({
  test: {
    root: __dirname,
    include: ['diagnostics/**/*.test.ts'],
    watch: false,
  },
})
