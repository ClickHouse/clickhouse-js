/// Static oracle snapshots: one JSON file per data-type string, holding the
/// `data_type` subtree the ClickHouse server emits. These let the snapshot test
/// run with no `clickhouse` binary — the server is only needed to (re)generate
/// them via `update_snapshots.ts`.

import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/// Directory holding the per-query snapshot files.
export const SNAPSHOT_DIR = join(here, "snapshots");

/// A stable filename for a type string (content-addressed, so reordering
/// cases.txt never churns filenames).
export function snapshotName(typeStr: string): string {
  return createHash("sha1").update(typeStr, "utf8").digest("hex").slice(0, 16) + ".json";
}

export function snapshotPath(typeStr: string): string {
  return join(SNAPSHOT_DIR, snapshotName(typeStr));
}

/// Self-describing snapshot payload (the `type` is stored so files are
/// readable / debuggable on their own).
export interface Snapshot {
  type: string;
  data_type: unknown;
}
