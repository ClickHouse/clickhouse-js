import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

// Match the Node examples package: change the working directory to the parent
// `examples/` directory so cwd()-based path resolution behaves consistently
// when examples run in Vitest forks from this package directory.
const examplesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(examplesDir)

// Some examples call `process.exit(0)` as a final success signal.
// In a Vitest worker, process.exit is intercepted and treated as an unexpected error,
// so we override it here:
//  - exit(0)  → no-op: let the async IIFE return normally so Vitest reports it as passed
//  - exit(≠0) → throw an Error so Vitest captures the failure with a useful message
process.exit = ((code?: number | string | null): never => {
  const exitCode = code !== null && code !== undefined ? Number(code) : 0
  if (exitCode !== 0) {
    throw new Error(`process.exit(${exitCode}) called`)
  }
  // exit(0) — intentional success signal, treat as no-op
  return undefined as never
}) as typeof process.exit

// Web examples read connection details from ambient globals (the bundler-injected
// pattern they would use in a real browser app). When running them under Vitest,
// expose the corresponding env values on `globalThis` so the bare identifiers
// resolve. Cluster URL always has a default; Cloud vars are only set when
// provided so the *_cloud.ts examples can detect them and skip in CI.
const g = globalThis as Record<string, unknown>
g['CLICKHOUSE_CLUSTER_URL'] =
  process.env['CLICKHOUSE_CLUSTER_URL'] ?? 'http://localhost:8127'
if (process.env['CLICKHOUSE_CLOUD_URL']) {
  g['CLICKHOUSE_CLOUD_URL'] = process.env['CLICKHOUSE_CLOUD_URL']
}
if (process.env['CLICKHOUSE_CLOUD_PASSWORD']) {
  g['CLICKHOUSE_CLOUD_PASSWORD'] = process.env['CLICKHOUSE_CLOUD_PASSWORD']
}
