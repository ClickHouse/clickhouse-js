// See https://clickhouse.com/docs/en/engines/table-engines/

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

export const MergeTree = () => ({
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
export const ReplicatedMergeTree = ({
  zoo_path,
  replica_name,
  ver,
}: ReplicatedMergeTreeParameters) => ({
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
