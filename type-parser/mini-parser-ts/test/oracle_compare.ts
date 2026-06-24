#!/usr/bin/env node
/// Compare the standalone parser's JSON AST against the ClickHouse server.
///
/// For each data type in the cases file, the expected output is the `data_type`
/// subtree the server produces for
///
///     EXPLAIN AST json = 1 CREATE TABLE t (c <TYPE>) ENGINE = Null
///
/// (version 2 of the format). The actual output is what `parseDataType` +
/// `toJSON` produce. The two JSON trees are compared structurally (key order
/// ignored). A TypeScript port of the Python `oracle_compare.py`.
///
/// Usage:
///   tsx test/oracle_compare.ts --clickhouse /path/to/clickhouse [--cases test/cases.txt]
///
/// The clickhouse binary must be built from
/// https://github.com/peter-leonov-ch/ClickHouse/pull/1 (the AST-format changes
/// this parser mirrors live in that PR).

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseDataType, toJSON } from "../src/index.js";
import { canon, deepEqual, readCases } from "./cases.js";

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]): { clickhouse: string; cases: string } {
  let clickhouse = "";
  let cases = join(here, "cases.txt");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--clickhouse") clickhouse = argv[++i] ?? "";
    else if (argv[i] === "--cases") cases = argv[++i] ?? cases;
  }
  if (!clickhouse) {
    console.error("error: --clickhouse <path> is required");
    process.exit(2);
  }
  return { clickhouse, cases };
}

/// Depth-first search for the ColumnDeclaration named `column`.
function findColumnDataType(node: unknown, column: string): unknown {
  if (Array.isArray(node)) {
    for (const v of node) {
      const found = findColumnDataType(v, column);
      if (found !== undefined) return found;
    }
  } else if (node !== null && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (obj["type"] === "ColumnDeclaration" && obj["name"] === column) {
      return obj["data_type"];
    }
    for (const v of Object.values(obj)) {
      const found = findColumnDataType(v, column);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function serverDataType(clickhouse: string, typeStr: string): unknown {
  const sql = `EXPLAIN AST json = 1 CREATE TABLE t (c ${typeStr}) ENGINE = Null`;
  const out = spawnSync(clickhouse, ["local", "--format", "TSVRaw", "-q", sql], {
    encoding: "utf8",
  });
  if (out.status !== 0) {
    throw new Error(`server failed: ${(out.stderr ?? "").trim()}`);
  }
  const doc = JSON.parse(out.stdout) as { version?: number; ast: unknown };
  if (doc.version !== 2) {
    throw new Error(`unexpected format version ${doc.version}`);
  }
  const dt = findColumnDataType(doc.ast, "c");
  if (dt === undefined) {
    throw new Error("could not locate column data_type in server AST");
  }
  return dt;
}

function toolDataType(typeStr: string): unknown {
  const result = parseDataType(typeStr);
  if (!result.ok()) {
    throw new Error(`parse failed: ${result.error!.message}`);
  }
  return JSON.parse(toJSON(result.ast!));
}

function main(): number {
  const { clickhouse, cases: casesPath } = parseArgs(process.argv.slice(2));
  const cases = readCases(casesPath);
  let failures = 0;

  for (const typeStr of cases) {
    let expected: unknown;
    let actual: unknown;
    try {
      expected = canon(serverDataType(clickhouse, typeStr));
      actual = canon(toolDataType(typeStr));
    } catch (exc) {
      console.log(`ERROR ${JSON.stringify(typeStr)}: ${(exc as Error).message}`);
      failures++;
      continue;
    }

    if (deepEqual(expected, actual)) {
      console.log(`  ok  ${typeStr}`);
    } else {
      failures++;
      console.log(`FAIL  ${typeStr}`);
      console.log("    expected:", JSON.stringify(expected));
      console.log("    actual:  ", JSON.stringify(actual));
    }
  }

  console.log(`\n${cases.length - failures}/${cases.length} passed`);
  return failures ? 1 : 0;
}

process.exit(main());
