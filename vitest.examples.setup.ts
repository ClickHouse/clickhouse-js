import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

// Examples reference data files relative to the examples/ directory (e.g. `./node/resources/data.csv`).
// Change the working directory to examples/ so that cwd()-based path resolution works correctly
// when examples run in Vitest forks from the repo root.
const examplesDir = resolve(dirname(fileURLToPath(import.meta.url)), 'examples')
process.chdir(examplesDir)

// Some examples call `process.exit(0)` as a final success signal.
// In a Vitest worker, process.exit is intercepted and treated as an unexpected error,
// so we override it here:
//  - exit(0)  → no-op: let the async IIFE return normally so Vitest reports it as passed
//  - exit(≠0) → throw an Error so Vitest captures the failure with a useful message
process.exit = ((code?: number | string | null): never => {
  const exitCode = code != null ? Number(code) : 0
  if (exitCode !== 0) {
    throw new Error(`process.exit(${exitCode}) called`)
  }
  // exit(0) — intentional success signal, treat as no-op
  return undefined as never
}) as typeof process.exit
