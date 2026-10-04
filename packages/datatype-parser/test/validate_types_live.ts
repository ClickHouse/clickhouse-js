#!/usr/bin/env node
/// Sanity-check that every type in cases.txt is a REAL ClickHouse type — i.e.
/// that we did not invent any — against a stock running server (no AST-JSON
/// support needed). Unlike `EXPLAIN SYNTAX`/`EXPLAIN AST`, which only check
/// syntax (they happily accept `Bogus(UInt8)`), this instantiates the type via
///
///     CREATE TEMPORARY TABLE _probe (c <TYPE>)
///
/// which forces the type factory to build the column and rejects unknown type
/// families with UNKNOWN_TYPE. Temporary tables are session-scoped (one per
/// HTTP request here), so nothing is persisted.
///
/// Experimental/suspicious types (Variant, Dynamic, JSON/Object, big
/// FixedString, suspicious LowCardinality, Time) are real but gated behind
/// settings, so we enable those settings — a failure then means the type
/// genuinely does not exist.
///
/// Usage: tsx test/validate_types_live.ts [--url http://localhost:8124/]

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { readCases } from "./cases.js";

const SETTINGS: Record<string, string> = {
  allow_experimental_object_type: "1",
  allow_experimental_variant_type: "1",
  allow_experimental_dynamic_type: "1",
  allow_experimental_json_type: "1",
  enable_json_type: "1",
  allow_experimental_geo_types: "1",
  allow_suspicious_low_cardinality_types: "1",
  allow_suspicious_variant_types: "1",
  allow_suspicious_fixed_string_types: "1",
  enable_time_time64_type: "1",
};

const CONCURRENCY = 16;

interface Failure {
  type: string;
  code: number | null;
  message: string;
}

async function probe(
  url: string,
  typeStr: string,
  i: number,
): Promise<Failure | null> {
  const sql = `CREATE TEMPORARY TABLE _chdt_probe_${i} (c ${typeStr})`;
  const resp = await fetch(url, { method: "POST", body: sql });
  if (resp.ok) {
    await resp.text();
    return null;
  }
  const body = (await resp.text()).trim();
  const m = body.match(/^Code:\s*(\d+)\./);
  const code = m ? Number(m[1]) : null;
  return { type: typeStr, code, message: body };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  let base = "http://localhost:8124/";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--url") base = argv[++i] ?? base;
  }
  const url = base + "?" + new URLSearchParams(SETTINGS).toString();

  const here = dirname(fileURLToPath(import.meta.url));
  const cases = readCases(join(here, "cases.txt"));
  /// Types the parser handles (and whose AST matches the server) but that the
  /// type factory refuses to instantiate — documented & expected, not bugs.
  const expectedNonInstantiable = new Set(
    readCases(join(here, "non_instantiable.txt")),
  );

  /// Confirm reachability up front.
  try {
    const v = await fetch(base, { method: "POST", body: "SELECT version()" });
    console.log(`server: ${(await v.text()).trim()}`);
  } catch (exc) {
    console.error(`error: cannot reach ${base}: ${(exc as Error).message}`);
    return 2;
  }

  const failures: Failure[] = [];
  let done = 0;
  for (let start = 0; start < cases.length; start += CONCURRENCY) {
    const batch = cases.slice(start, start + CONCURRENCY);
    const results = await Promise.all(
      batch.map((t, k) => probe(url, t, start + k)),
    );
    for (const f of results) if (f) failures.push(f);
    done += batch.length;
    process.stderr.write(`  ... ${done}/${cases.length}\n`);
  }

  const expected = failures.filter((f) => expectedNonInstantiable.has(f.type));
  const unexpected = failures.filter(
    (f) => !expectedNonInstantiable.has(f.type),
  );

  console.log(`\nchecked ${cases.length} types`);
  console.log(`instantiated OK: ${cases.length - failures.length}`);
  console.log(
    `expected non-instantiable (allowlisted, see non_instantiable.txt): ${expected.length}`,
  );
  console.log(`UNEXPECTED failures: ${unexpected.length}`);

  if (expected.length) {
    console.log(
      `\n## expected non-instantiable (parser-valid by design — NOT inventions)`,
    );
    for (const f of expected)
      console.log(
        `- ${f.type}\n    Code ${f.code}: ${f.message.split("\n")[0]}`,
      );
  }
  if (unexpected.length) {
    console.log(`\n## UNEXPECTED — server does not accept these (review!)`);
    for (const f of unexpected)
      console.log(
        `- ${f.type}\n    Code ${f.code}: ${f.message.split("\n")[0]}`,
      );
  }

  /// Also flag anything allowlisted that now DOES instantiate (stale entry).
  const okSet = new Set(
    cases.filter((t) => !failures.some((f) => f.type === t)),
  );
  const stale = [...expectedNonInstantiable].filter((t) => okSet.has(t));
  if (stale.length) {
    console.log(
      `\n## stale allowlist entries (now instantiate — remove from non_instantiable.txt)`,
    );
    for (const t of stale) console.log(`- ${t}`);
  }

  return unexpected.length ? 1 : 0;
}

process.exit(await main());
