/**
 * vitest-pool-bun — a custom Vitest 4.1 pool that executes test files inside
 * the Bun runtime.
 *
 * The Node host owns the Vite transform pipeline; Bun owns test execution.
 *
 * @example Minimal usage
 * ```ts
 * // vitest.config.ts
 * import { defineBunPoolConfig } from 'vitest-pool-bun'
 *
 * export default defineBunPoolConfig({
 *   test: { include: ['tests/**\/*.test.ts'] },
 * })
 * ```
 *
 * @example Wiring the pool directly
 * ```ts
 * import { defineConfig } from 'vitest/config'
 * import { bunPool } from 'vitest-pool-bun'
 *
 * export default defineConfig({
 *   test: { pool: bunPool() },
 * })
 * ```
 */
import { defineConfig, type ViteUserConfig } from 'vitest/config'
import type { PoolRunnerInitializer } from 'vitest/node'
import { BunPoolWorker } from './pool-worker.js'
import type { BunPoolOptions } from './types.js'

export type { BunPoolOptions } from './types.js'
export { BunPoolWorker } from './pool-worker.js'

/**
 * Create the {@link PoolRunnerInitializer} that runs test files in Bun.
 *
 * Pass the result to Vitest's `test.pool` option. The `name` (`"bun"`) must
 * match the worker's name — Vitest routes a test file to this pool when its
 * resolved pool name equals `"bun"`.
 */
export function bunPool(options: BunPoolOptions = {}): PoolRunnerInitializer {
  return {
    name: 'bun',
    createPoolWorker: (poolOptions) => new BunPoolWorker(poolOptions, options),
  }
}

/** Options for {@link defineBunPoolConfig}. */
export interface DefineBunPoolConfigOptions {
  /** Options forwarded to {@link bunPool}. */
  pool?: BunPoolOptions
}

/**
 * Convenience wrapper around `defineConfig` that wires {@link bunPool} into
 * `test.pool` so users can keep their `vitest.config.ts` minimal.
 *
 * Any `test.pool` supplied in `config` is overridden by the Bun pool.
 */
export function defineBunPoolConfig(
  config: ViteUserConfig = {},
  options: DefineBunPoolConfigOptions = {},
): ViteUserConfig {
  return defineConfig({
    ...config,
    test: {
      ...config.test,
      pool: bunPool(options.pool),
    },
  }) as ViteUserConfig
}
