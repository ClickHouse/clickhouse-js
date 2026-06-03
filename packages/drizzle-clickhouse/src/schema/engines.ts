import { quoteStringLiteral } from '../escape.js'
import type { SQL } from '../sql.js'

/**
 * A serialized ClickHouse table engine clause. Construct via the helpers
 * exported below (`mergeTree()`, `replacingMergeTree(...)`, etc.) rather than
 * by hand.
 */
export interface Engine {
  readonly clause: string
}

const make = (clause: string): Engine => ({ clause })

export const mergeTree = () => make('MergeTree()')

export const replacingMergeTree = (
  versionColumn?: string,
  isDeletedColumn?: string,
) => {
  const args: string[] = []
  if (versionColumn) args.push(versionColumn)
  if (isDeletedColumn) {
    if (!versionColumn) {
      throw new Error(
        '[drizzle-clickhouse] replacingMergeTree: isDeletedColumn requires versionColumn',
      )
    }
    args.push(isDeletedColumn)
  }
  return make(`ReplacingMergeTree(${args.join(', ')})`)
}

export const summingMergeTree = (columns?: string[]) =>
  make(
    columns && columns.length > 0
      ? `SummingMergeTree((${columns.join(', ')}))`
      : 'SummingMergeTree()',
  )

export const aggregatingMergeTree = () => make('AggregatingMergeTree()')

export const collapsingMergeTree = (signColumn: string) =>
  make(`CollapsingMergeTree(${signColumn})`)

export const versionedCollapsingMergeTree = (
  signColumn: string,
  versionColumn: string,
) => make(`VersionedCollapsingMergeTree(${signColumn}, ${versionColumn})`)

export const memory = () => make('Memory')
export const nullEngine = () => make('Null')
export const log = () => make('Log')
export const tinyLog = () => make('TinyLog')
export const stripeLog = () => make('StripeLog')

export const replicated = (
  base: Engine,
  zooPath: string,
  replicaName: string,
): Engine => {
  // Insert the replication args after the engine name (works for MergeTree
  // family which is what supports Replicated*).
  const m = /^([A-Za-z][A-Za-z0-9]*)\((.*)\)$/.exec(base.clause)
  if (!m) {
    throw new Error(
      '[drizzle-clickhouse] replicated(): unrecognised base engine clause',
    )
  }
  const [, name, args] = m
  const head = `Replicated${name}(${quoteStringLiteral(zooPath)}, ${quoteStringLiteral(replicaName)}`
  return make(args.length > 0 ? `${head}, ${args})` : `${head})`)
}

export const distributed = (
  cluster: string,
  database: string,
  table: string,
  shardingKey?: SQL | string,
): Engine => {
  const parts = [
    quoteStringLiteral(cluster),
    quoteStringLiteral(database),
    quoteStringLiteral(table),
  ]
  if (shardingKey) {
    parts.push(
      typeof shardingKey === 'string' ? shardingKey : '__sharding_key__',
    )
    // For SQL fragments, we'd need to compile in caller context; keep the
    // common-case string form for MVP and document this as a Phase 2 follow-up.
    if (typeof shardingKey !== 'string') {
      throw new Error(
        '[drizzle-clickhouse] distributed(): SQL shardingKey not yet supported; pass a column name as string',
      )
    }
  }
  return make(`Distributed(${parts.join(', ')})`)
}
