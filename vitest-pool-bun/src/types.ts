/**
 * Public options for the Bun pool.
 *
 * Kept intentionally small for the proof of concept. Anything not required to
 * hit a phase acceptance gate is deferred (see the execution plan, §1 non-goals).
 */
export interface BunPoolOptions {
  /**
   * Path (or bare command name) of the `bun` executable used to spawn workers.
   *
   * Resolution order when not provided:
   *   1. `process.env.BUN_BINARY`
   *   2. the literal `"bun"` (resolved through `PATH`)
   */
  bunBinary?: string

  /**
   * Extra CLI arguments passed to `bun run <worker-entry>`.
   * Defaults to `[]`.
   */
  bunArgs?: string[]

  /**
   * Additional environment variables for the spawned Bun worker process.
   * Merged on top of the environment Vitest provides for the task.
   */
  env?: Record<string, string | undefined>
}
