import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    root: 'packages/client-node/__tests__',
    include: ['unit/*.test.ts', 'utils/*.test.ts'],
  },
})
