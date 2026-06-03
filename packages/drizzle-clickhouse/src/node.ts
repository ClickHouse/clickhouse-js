/**
 * Node entry point. Wraps a `@clickhouse/client` instance (or its config) in
 * a {@link ClickHouseDatabase}.
 */
import {
  ClickHouseDatabase,
  type ClickHouseClientLike,
  type DrizzleOptions,
} from './session/base.js'

export * from './index.js'

/**
 * Construct a Drizzle-style database handle around an existing
 * `@clickhouse/client` instance. Accepts anything that implements the
 * minimal {@link ClickHouseClientLike} surface so the package can be tested
 * (and tree-shaken in non-Node bundles) without a hard dependency on the
 * Node client.
 */
export function drizzle(
  client: ClickHouseClientLike,
  options?: DrizzleOptions,
): ClickHouseDatabase {
  return new ClickHouseDatabase(client, options)
}
