#!/usr/bin/env python3
"""Compare the standalone parser's JSON AST against the ClickHouse server.

For each data type in the cases file, the expected output is the `data_type`
subtree the server produces for

    EXPLAIN AST json = 1 CREATE TABLE t (c <TYPE>) ENGINE = Null

(version 2 of the format). The actual output is `chdt-parse <TYPE>`. The two
JSON trees are compared structurally (key order ignored).
"""

import argparse
import json
import subprocess
import sys


def canon(value):
    """Recursively sort dict keys so comparison ignores key order."""
    if isinstance(value, dict):
        return {k: canon(value[k]) for k in sorted(value)}
    if isinstance(value, list):
        return [canon(v) for v in value]
    return value


def find_column_data_type(node, column):
    """Depth-first search for the ColumnDeclaration named `column`."""
    if isinstance(node, dict):
        if node.get("type") == "ColumnDeclaration" and node.get("name") == column:
            return node.get("data_type")
        for v in node.values():
            found = find_column_data_type(v, column)
            if found is not None:
                return found
    elif isinstance(node, list):
        for v in node:
            found = find_column_data_type(v, column)
            if found is not None:
                return found
    return None


def server_data_type(clickhouse, type_str):
    sql = f"EXPLAIN AST json = 1 CREATE TABLE t (c {type_str}) ENGINE = Null"
    out = subprocess.run(
        [clickhouse, "local", "--format", "TSVRaw", "-q", sql],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        raise RuntimeError(f"server failed: {out.stderr.strip()}")
    doc = json.loads(out.stdout)
    if doc.get("version") != 2:
        raise RuntimeError(f"unexpected format version {doc.get('version')}")
    dt = find_column_data_type(doc["ast"], "c")
    if dt is None:
        raise RuntimeError("could not locate column data_type in server AST")
    return dt


def tool_data_type(tool, type_str):
    out = subprocess.run([tool, type_str], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"chdt-parse failed: {out.stderr.strip()}")
    return json.loads(out.stdout)


def read_cases(path):
    cases = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                cases.append(line)
    return cases


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clickhouse", required=True)
    ap.add_argument("--tool", required=True)
    ap.add_argument("--cases", required=True)
    args = ap.parse_args()

    cases = read_cases(args.cases)
    failures = 0
    for type_str in cases:
        try:
            expected = canon(server_data_type(args.clickhouse, type_str))
            actual = canon(tool_data_type(args.tool, type_str))
        except Exception as exc:  # noqa: BLE001
            print(f"ERROR {type_str!r}: {exc}")
            failures += 1
            continue

        if expected == actual:
            print(f"  ok  {type_str}")
        else:
            failures += 1
            print(f"FAIL  {type_str}")
            print("    expected:", json.dumps(expected))
            print("    actual:  ", json.dumps(actual))

    print(f"\n{len(cases) - failures}/{len(cases)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
