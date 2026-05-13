import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  test: {
    name: 'examples-web',
    include: ['**/*.ts'],
    // Examples are intentionally duplicated across category folders so each
    // category is a self-contained "skill corpus". To keep CI runtime stable,
    // each example runs once from its primary location; secondary copies are
    // excluded below. Keep this list in sync with examples/README.md.
    exclude: [
      'node_modules/**',
      '**/*.d.ts',
      'vitest.config.ts',
      'vitest.setup.ts',
      // Duplicates of `coding/` files
      'troubleshooting/ping_non_existing_host.ts',
      'troubleshooting/custom_json_handling.ts',
      'security/query_with_parameter_binding.ts',
      'security/query_with_parameter_binding_special_chars.ts',
      'schema-and-deployments/insert_ephemeral_columns.ts',
      'schema-and-deployments/insert_exclude_columns.ts',
      'schema-and-deployments/url_configuration.ts',
      // Duplicate of `security/read_only_user.ts`
      'troubleshooting/read_only_user.ts',
    ],
    setupFiles: ['vitest.setup.ts'],
    pool: 'forks',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    passWithNoTests: true,
    reporters: ['verbose'],
    env: {
      CLICKHOUSE_URL: process.env['CLICKHOUSE_URL'] ?? 'http://localhost:8123',
      CLICKHOUSE_PASSWORD: process.env['CLICKHOUSE_PASSWORD'] ?? '',
      CLICKHOUSE_CLUSTER_URL:
        process.env['CLICKHOUSE_CLUSTER_URL'] ?? 'http://localhost:8127',
      CLICKHOUSE_CLOUD_URL: process.env['CLICKHOUSE_CLOUD_URL'],
      CLICKHOUSE_CLOUD_PASSWORD: process.env['CLICKHOUSE_CLOUD_PASSWORD'],
    },
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
