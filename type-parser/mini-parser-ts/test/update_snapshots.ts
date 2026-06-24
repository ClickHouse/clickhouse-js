#!/usr/bin/env node
/// Regenerate the static oracle snapshots from a real ClickHouse server.
///
/// For every candidate type (existing cases.txt entries + the candidates file)
/// this:
///   1. asks the server for the `data_type` subtree,
///   2. parses the same type with the standalone parser,
///   3. compares them structurally.
/// Only types where the server ACCEPTS the type AND the parser MATCHES the
/// server are kept: new ones are appended to cases.txt, and a snapshot file is
/// written for every kept case. Types the server rejects, or where the parser
/// diverges, are dropped and listed in a report (never silently added).
///
/// Usage:
///   tsx test/update_snapshots.ts --clickhouse /path/to/clickhouse \
///       [--candidates test/candidates.txt] [--cases test/cases.txt]
///
/// The clickhouse binary must be built from
/// https://github.com/peter-leonov-ch/ClickHouse/pull/1.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { canon, deepEqual, readCases } from "./cases.js";
import { serverDataType, toolDataType } from "./oracle.js";
import {
  SNAPSHOT_DIR,
  snapshotName,
  snapshotPath,
  type Snapshot,
} from "./snapshots.js";

const here = dirname(fileURLToPath(import.meta.url));

interface Args {
  clickhouse: string;
  cases: string;
  candidates: string;
}

function parseArgs(argv: string[]): Args {
  let clickhouse = "";
  let cases = join(here, "cases.txt");
  let candidates = join(here, "candidates.txt");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--clickhouse") clickhouse = argv[++i] ?? "";
    else if (argv[i] === "--cases") cases = argv[++i] ?? cases;
    else if (argv[i] === "--candidates") candidates = argv[++i] ?? candidates;
  }
  if (!clickhouse) {
    console.error("error: --clickhouse <path> is required");
    process.exit(2);
  }
  return { clickhouse, cases, candidates };
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));

  /// Existing curated cases stay first and keep their order; new candidates are
  /// appended. Dedup by exact (trimmed) string across both sources.
  const existing = readCases(args.cases);
  const existingSet = new Set(existing);
  const candidates = existsSync(args.candidates)
    ? readCases(args.candidates)
    : [];

  const order: string[] = [];
  const seen = new Set<string>();
  for (const c of [...existing, ...candidates]) {
    if (!seen.has(c)) {
      seen.add(c);
      order.push(c);
    }
  }

  mkdirSync(SNAPSHOT_DIR, { recursive: true });

  const kept: string[] = [];
  const rejected: { type: string; reason: string }[] = [];
  const divergent: { type: string; expected: string; actual: string }[] = [];

  let i = 0;
  for (const typeStr of order) {
    i++;
    if (i % 25 === 0) process.stderr.write(`  ... ${i}/${order.length}\n`);

    let expected: unknown;
    try {
      expected = serverDataType(args.clickhouse, typeStr);
    } catch (exc) {
      rejected.push({
        type: typeStr,
        reason: `server: ${(exc as Error).message}`,
      });
      continue;
    }

    let actual: unknown;
    try {
      actual = toolDataType(typeStr);
    } catch (exc) {
      divergent.push({
        type: typeStr,
        expected: JSON.stringify(canon(expected)),
        actual: `(${(exc as Error).message})`,
      });
      continue;
    }

    if (!deepEqual(expected, actual)) {
      divergent.push({
        type: typeStr,
        expected: JSON.stringify(canon(expected)),
        actual: JSON.stringify(canon(actual)),
      });
      continue;
    }

    /// Kept: write the snapshot holding the server's data_type subtree.
    const snap: Snapshot = { type: typeStr, data_type: expected };
    writeFileSync(snapshotPath(typeStr), JSON.stringify(snap, null, 2) + "\n");
    kept.push(typeStr);
  }

  /// Append newly-kept cases (not already present) to cases.txt.
  const newKept = kept.filter((c) => !existingSet.has(c));
  if (newKept.length > 0) {
    const block =
      "\n# === generated cases (validated against the server oracle; see update_snapshots.ts) ===\n" +
      newKept.join("\n") +
      "\n";
    appendFileSync(args.cases, block);
  }

  /// Prune snapshot files that no longer correspond to a kept case.
  const keepFiles = new Set(kept.map(snapshotName));
  let pruned = 0;
  for (const f of readdirSync(SNAPSHOT_DIR)) {
    if (f.endsWith(".json") && !keepFiles.has(f)) {
      rmSync(join(SNAPSHOT_DIR, f));
      pruned++;
    }
  }

  /// Write a human-readable report of what was dropped.
  const reportLines: string[] = [];
  reportLines.push(`# snapshot update report`);
  reportLines.push(`candidates considered: ${order.length}`);
  reportLines.push(
    `kept (snapshotted):    ${kept.length}  (new in cases.txt: ${newKept.length})`,
  );
  reportLines.push(`rejected by server:    ${rejected.length}`);
  reportLines.push(`divergent (server!=parser): ${divergent.length}`);
  reportLines.push(`pruned stale snapshots: ${pruned}`);
  if (rejected.length) {
    reportLines.push(`\n## rejected by server (invalid type / not accepted)`);
    for (const r of rejected) reportLines.push(`- ${r.type}\n    ${r.reason}`);
  }
  if (divergent.length) {
    reportLines.push(
      `\n## divergent (server accepted but parser output differs)`,
    );
    for (const d of divergent) {
      reportLines.push(`- ${d.type}`);
      reportLines.push(`    expected: ${d.expected}`);
      reportLines.push(`    actual:   ${d.actual}`);
    }
  }
  writeFileSync(
    join(here, "snapshots_report.txt"),
    reportLines.join("\n") + "\n",
  );

  console.log(reportLines.slice(0, 6).join("\n"));
  console.log(`\nreport: test/snapshots_report.txt`);
  return 0;
}

process.exit(main());
