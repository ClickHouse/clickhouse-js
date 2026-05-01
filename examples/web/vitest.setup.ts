// Web examples read connection details from ambient globals (the bundler-injected
// pattern they would use in a real browser app). When running them under Vitest,
// expose the corresponding env values on `globalThis` so the bare identifiers
// resolve. Cluster URL always has a default; Cloud vars are only set when
// provided so the *_cloud.ts examples can detect them and skip in CI.
const g = globalThis as Record<string, unknown>

g['CLICKHOUSE_CLUSTER_URL'] =
  import.meta.env['CLICKHOUSE_CLUSTER_URL'] ?? 'http://localhost:8127'
g['CLICKHOUSE_CLOUD_URL'] = import.meta.env['CLICKHOUSE_CLOUD_URL']
g['CLICKHOUSE_CLOUD_PASSWORD'] = import.meta.env['CLICKHOUSE_CLOUD_PASSWORD']
