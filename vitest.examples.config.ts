import { resolve } from 'path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * A Vite transform plugin that replaces `void (async () => {` with
 * `await (async () => {` in example files, turning the top-level IIFE
 * call into a top-level `await` expression.
 *
 * This makes Vitest wait for each example's async body to complete
 * (and surface any errors as test failures) without modifying the
 * example source files.
 */
function awaitExamplesPlugin(): Plugin {
  return {
    name: 'await-examples',
    transform(code: string, id: string) {
      if (id.includes('/node_modules/')) return null
      if (!id.endsWith('.ts')) return null
      if (!id.includes('/examples/')) return null
      return {
        code: code.replace(/^void \(async \(\) => \{/m, 'await (async () => {'),
        map: null,
      }
    },
  }
}

/**
 * Examples that cannot be run in a standard single-node CI environment.
 */
const EXCLUDED_EXAMPLES = [
  // Requires ClickHouse Cloud credentials
  'examples/create_table_cloud.ts',
  // Requires a multi-node ClickHouse cluster
  'examples/create_table_on_premise_cluster.ts',
  // Require TLS certificates and a special ClickHouse TLS instance
  'examples/node/basic_tls.ts',
  'examples/node/mutual_tls.ts',
  // Designed as a production-scenario demo; intentionally uses very long timeouts (up to 400 s)
  'examples/long_running_queries_timeouts.ts',
  // Designed to run indefinitely; they never resolve on their own
  'examples/async_insert_without_waiting.ts',
  'examples/node/insert_streaming_with_backpressure.ts',
]

export default defineConfig({
  plugins: [awaitExamplesPlugin()],
  test: {
    name: 'examples',
    include: ['examples/*.ts', 'examples/node/*.ts'],
    exclude: EXCLUDED_EXAMPLES,
    setupFiles: ['vitest.examples.setup.ts'],
    pool: 'forks',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    passWithNoTests: true,
    reporter: ['verbose'],
    env: {
      CLICKHOUSE_URL: process.env['CLICKHOUSE_URL'] ?? 'http://localhost:8123',
      CLICKHOUSE_PASSWORD: process.env['CLICKHOUSE_PASSWORD'] ?? '',
    },
  },
  resolve: {
    alias: {
      '@clickhouse/client': resolve('packages/client-node/src'),
      '@clickhouse/client-common': resolve('packages/client-common/src'),
    },
  },
})
