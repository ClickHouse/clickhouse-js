/**
 * Web entry point. Wraps a `@clickhouse/client-web` instance in a
 * {@link ClickHouseDatabase}. The shape is identical to the Node entry — the
 * two files exist primarily for documentation/discoverability and to give
 * bundlers an explicit per-environment import path.
 */
import {
  ClickHouseDatabase,
  type ClickHouseClientLike,
  type DrizzleOptions,
} from './session/base.js'

export * from './index.js'

export function drizzle(
  client: ClickHouseClientLike,
  options?: DrizzleOptions,
): ClickHouseDatabase {
  return new ClickHouseDatabase(client, options)
}
