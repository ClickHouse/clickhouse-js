/**
 * Common, driver-agnostic surface of @clickhouse/drizzle-orm.
 *
 * For end users, prefer the driver-specific entry points:
 *
 *   import { drizzle } from '@clickhouse/drizzle-orm/node'
 *   import { drizzle } from '@clickhouse/drizzle-orm/web'
 */

// SQL building blocks
export {
  sql,
  ident,
  param,
  compile,
  SQL,
  SQLPlaceholder,
  Identifier,
} from './sql.js'
export type { CompiledSQL, BoundParam, SQLChunk } from './sql.js'

// Schema DSL
export { Column } from './schema/columns.js'
export {
  string,
  fixedString,
  uuid,
  ipv4,
  ipv6,
  bool,
  int8,
  int16,
  int32,
  int64,
  int128,
  int256,
  uint8,
  uint16,
  uint32,
  uint64,
  uint128,
  uint256,
  float32,
  float64,
  decimal,
  date,
  date32,
  dateTime,
  dateTime64,
  enum8,
  enum16,
  array,
  lowCardinality,
  nullable,
  tuple,
  map,
  json,
  raw,
} from './schema/columns.js'

export { clickhouseTable, Table } from './schema/table.js'
export type { TableConfig, TableColumns } from './schema/table.js'

export {
  mergeTree,
  replacingMergeTree,
  summingMergeTree,
  aggregatingMergeTree,
  collapsingMergeTree,
  versionedCollapsingMergeTree,
  memory,
  nullEngine,
  log,
  tinyLog,
  stripeLog,
  replicated,
  distributed,
} from './schema/engines.js'
export type { Engine } from './schema/engines.js'

// Dialect / query builders / session
export { ClickHouseDialect } from './dialect.js'
export type {
  SelectPlan,
  FromClause,
  Projection,
  WithClause,
  OrderByClause,
} from './dialect.js'

export { SelectBuilder } from './query-builders/select.js'
export { InsertBuilder } from './query-builders/insert.js'

export { ClickHouseDatabase } from './session/base.js'
export type { ClickHouseClientLike, DrizzleOptions } from './session/base.js'

export { NoopLogger, ConsoleLogger, UnsupportedFeatureError } from './types.js'
export type { DrizzleLogger, ScalarTypeTag } from './types.js'
