import type { DataFormat } from "../data_formatter";

/**
 * Rewrites user SQL before the client sends it.
 * Internal: not exported from the package index.
 */
export interface SqlRewriter {
  /** The query sent by `query()`: trailing semicolons removed and `FORMAT <format>` added. */
  withFormat(query: string, format: DataFormat): string;
  /** The query sent by `command()` and `exec()`: trailing semicolons removed. */
  stripTrailingSemi(query: string): string;
}
