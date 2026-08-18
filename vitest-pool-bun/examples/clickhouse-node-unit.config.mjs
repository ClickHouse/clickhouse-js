import { fileURLToPath } from 'node:url'
import { defineBunPoolConfig } from '../dist/index.js'

export default defineBunPoolConfig({
  test: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: [
      'packages/client-node/__tests__/unit/node_user_agent.test.ts',
      'packages/client-node/__tests__/unit/node_default_logger.test.ts',
    ],
    watch: false,
  },
  resolve: {
    alias: {
      '@clickhouse/client-common': fileURLToPath(
        new URL('../../packages/client-common/src', import.meta.url),
      ),
      '@clickhouse/client-node': fileURLToPath(
        new URL('../../packages/client-node/src', import.meta.url),
      ),
      '@test': fileURLToPath(
        new URL('../../packages/client-common/__tests__', import.meta.url),
      ),
    },
  },
})
