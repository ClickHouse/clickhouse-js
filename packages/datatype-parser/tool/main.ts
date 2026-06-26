#!/usr/bin/env node
/// chdt-parse: read a ClickHouse data-type string and print its JSON AST.
///
///   chdt-parse "Array(Nullable(UInt64))"            # type from arguments
///   echo "Tuple(a UInt8, b String)" | chdt-parse    # type from stdin
///
/// Prints the JSON AST and exits 0 on success. On a parse error, prints
/// "error: <message> (at byte N)" to stderr and exits 1.
///
/// A TypeScript port of the C++ `tool/main.cpp`.

import { readFileSync } from "node:fs";

import { parseDataType, toJSON } from "../src/index.ts";

function readStdin(): string {
  try {
    /// fd 0 = stdin. Read synchronously so the CLI behaves like the C++ one.
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main(argv: string[]): number {
  let input: string;
  if (argv.length > 0) {
    input = argv.join(" ");
  } else {
    input = readStdin();
  }

  /// Trim trailing newline/whitespace from stdin.
  input = input.replace(/[\n\r \t]+$/, "");

  const result = parseDataType(input);
  if (!result.ok()) {
    const err = result.error!;
    process.stderr.write(`error: ${err.message} (at byte ${err.position})\n`);
    return 1;
  }

  process.stdout.write(toJSON(result.ast!) + "\n");
  return 0;
}

process.exit(main(process.argv.slice(2)));
