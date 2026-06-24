#!/usr/bin/env node
/// Assert that the parser rejects the deliberately-unsupported types.
/// A TypeScript port of the Python `check_unsupported.py`.
///
/// Usage: tsx test/check_unsupported.ts [--cases test/cases_unsupported.txt]

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseDataType } from "../src/index.js";
import { readCases } from "./cases.js";

const here = dirname(fileURLToPath(import.meta.url));

function main(): number {
  const argv = process.argv.slice(2);
  let casesPath = join(here, "cases_unsupported.txt");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cases") casesPath = argv[++i] ?? casesPath;
  }

  const cases = readCases(casesPath);
  let failures = 0;
  for (const typeStr of cases) {
    if (!parseDataType(typeStr).ok()) {
      console.log(`  ok  rejected: ${typeStr}`);
    } else {
      failures++;
      console.log(`FAIL  unexpectedly accepted: ${typeStr}`);
    }
  }

  console.log(`\n${cases.length - failures}/${cases.length} correctly rejected`);
  return failures ? 1 : 0;
}

process.exit(main());
