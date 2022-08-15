// See https://clickhouse.com/docs/en/engines/table-engines/

export type TableEngine = MergeTreeFamily;

type MergeTreeFamily =
  | ReturnType<typeof MergeTree>
  | ReturnType<typeof ReplicatedMergeTree>;

// https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree#settings
// TODO: refined types?
// TODO: storage_policy
export interface MergeTreeSettings {
  index_granularity?: number;
  index_granularity_bytes?: number;
  min_index_granularity_bytes?: number;
  enable_mixed_granularity_parts?: 0 | 1;
  use_minimalistic_part_header_in_zookeeper?: 0 | 1;
  min_merge_bytes_to_use_direct_io?: number;
  merge_with_ttl_timeout?: number;
  merge_with_recompression_ttl_timeout?: number;
  try_fetch_recompressed_part_timeout?: number;
  write_final_mark?: number;
  merge_max_block_size?: number;
  min_bytes_for_wide_part?: number;
  min_rows_for_wide_part?: number;
  max_parts_in_total?: number;
  max_compress_block_size?: number;
  min_compress_block_size?: number;
  max_partitions_to_read?: number;
}
export const MergeTree: () => Engine = () => ({
  toString: () => `MergeTree()`,
  type: 'MergeTree',
});

// https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/replication/#replicatedmergetree-parameters
// TODO: figure out the complete usage of "other_parameters"
export interface ReplicatedMergeTreeParameters {
  zoo_path: string;
  replica_name: string;
  ver?: string;
}
export const ReplicatedMergeTree: (
  parameters: ReplicatedMergeTreeParameters
) => Engine = ({ zoo_path, replica_name, ver }) => ({
  toString: () =>
    `ReplicatedMergeTree('${zoo_path}', '${replica_name}', ${ver})`, // FIXME ver
  type: 'ReplicatedMergeTree',
});

// please ignore for now

// class ReplacingMergeTree implements Show {
//   constructor(private readonly ver?: string) {}
//
//   show(): string {
//     return `ReplacingMergeTree(${this.ver || ''})`;
//   }
// }
// class SummingMergeTree implements Show {
//   constructor(private readonly columns?: string[]) {}
//
//   show(): string {
//     return `SummingMergeTree(${(this.columns || []).join(', ')})`;
//   }
// }
// class AggregatingMergeTree implements Show {
//   show(): string {
//     return 'AggregatingMergeTree()';
//   }
// }
// class CollapsingMergeTree implements Show {
//   constructor(private readonly sign: string) {}
//
//   show(): string {
//     return `CollapsingMergeTree(${this.sign})`;
//   }
// }
// class VersionedCollapsingMergeTree implements Show {
//   constructor(
//     private readonly sign: string,
//     private readonly version: string
//   ) {}
//
//   show(): string {
//     return `VersionedCollapsingMergeTree(${this.sign}, ${this.version})`;
//   }
// }
// class GraphiteMergeTree implements Show {
//   constructor(private readonly config_section: string) {}
//
//   show(): string {
//     return `CollapsingMergeTree(${this.config_section})`;
//   }
// }

interface Engine {
  toString(): string;
  type: 'MergeTree' | 'ReplicatedMergeTree';
}
