import { defineBunPoolConfig } from '../dist/index.js'

export default defineBunPoolConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The PoC targets a single `vitest run`; disable watch niceties.
    watch: false,
  },
})
