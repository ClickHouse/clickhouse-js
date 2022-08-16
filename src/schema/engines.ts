// See https://clickhouse.com/docs/en/engines/table-engines/

interface Engine {
  toString(): string
  type:
    | 'MergeTree'
    | 'ReplicatedMergeTree'
    | 'ReplacingMergeTree'
    | 'SummingMergeTree'
    | 'AggregatingMergeTree'
    | 'CollapsingMergeTree'
    | 'VersionedCollapsingMergeTree'
    | 'GraphiteMergeTree'
}

// TODO Log family
export type TableEngine = MergeTreeFamily

type MergeTreeFamily =
  | ReturnType<typeof MergeTree>
  | ReturnType<typeof ReplicatedMergeTree>
  | ReturnType<typeof ReplacingMergeTree>
  | ReturnType<typeof SummingMergeTree>
  | ReturnType<typeof AggregatingMergeTree>
  | ReturnType<typeof CollapsingMergeTree>
  | ReturnType<typeof VersionedCollapsingMergeTree>
  | ReturnType<typeof GraphiteMergeTree>

// https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree#settings
// TODO: refined types?
// TODO: storage_policy
export interface MergeTreeSettings {
  index_granularity?: number
  index_granularity_bytes?: number
  min_index_granularity_bytes?: number
  enable_mixed_granularity_parts?: 0 | 1
  use_minimalistic_part_header_in_zookeeper?: 0 | 1
  min_merge_bytes_to_use_direct_io?: number
  merge_with_ttl_timeout?: number
  merge_with_recompression_ttl_timeout?: number
  try_fetch_recompressed_part_timeout?: number
  write_final_mark?: number
  merge_max_block_size?: number
  min_bytes_for_wide_part?: number
  min_rows_for_wide_part?: number
  max_parts_in_total?: number
  max_compress_block_size?: number
  min_compress_block_size?: number
  max_partitions_to_read?: number
}
export const MergeTree: () => Engine = () => ({
  toString: () => `MergeTree()`,
  type: 'MergeTree',
})

// https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/replication/#replicatedmergetree-parameters
// TODO: figure out the complete usage of "other_parameters"
export interface ReplicatedMergeTreeParameters {
  zoo_path: string
  replica_name: string
  ver?: string
}
export const ReplicatedMergeTree: (
  parameters: ReplicatedMergeTreeParameters
) => Engine = ({ zoo_path, replica_name, ver }) => ({
  toString: () => {
    const _ver = ver ? `, ${ver}` : ''
    return `ReplicatedMergeTree('${zoo_path}', '${replica_name}'${_ver})`
  },
  type: 'ReplicatedMergeTree',
})

export const ReplacingMergeTree = (ver?: string) => ({
  toString: () => {
    const _ver = ver ? `, ${ver}` : ''
    return `ReplacingMergeTree(${_ver})`
  },
  type: 'ReplacingMergeTree',
})

export const SummingMergeTree = (columns?: string[]) => ({
  toString: () => {
    return `SummingMergeTree(${(columns || []).join(', ')})`
  },
  type: 'SummingMergeTree',
})

export const AggregatingMergeTree = () => ({
  toString: () => {
    return `AggregatingMergeTree()`
  },
  type: 'AggregatingMergeTree',
})

export const CollapsingMergeTree = (sign: string) => ({
  toString: () => {
    return `CollapsingMergeTree(${sign})`
  },
  type: 'CollapsingMergeTree',
})

export const VersionedCollapsingMergeTree = (
  sign: string,
  version: string
) => ({
  toString: () => {
    return `VersionedCollapsingMergeTree(${sign}, ${version})`
  },
  type: 'VersionedCollapsingMergeTree',
})

export const GraphiteMergeTree = (config_section: string) => ({
  toString: () => {
    return `CollapsingMergeTree(${config_section})`
  },
  type: 'GraphiteMergeTree',
})
