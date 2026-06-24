/// Shared oracle helpers: talk to a real ClickHouse server to obtain the
/// expected `data_type` subtree, and run the standalone parser. Used by the
/// live oracle comparison and by the snapshot updater.

import { spawnSync } from "node:child_process";

import { parseDataType, toJSON } from "../src/index.js";

/// Depth-first search for the ColumnDeclaration named `column`.
export function findColumnDataType(node: unknown, column: string): unknown {
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

/// The `data_type` subtree the server produces for
/// `EXPLAIN AST json = 1 CREATE TABLE t (c <TYPE>) ENGINE = Null`. Throws on a
/// server error (invalid type) or an unexpected AST shape.
export function serverDataType(clickhouse: string, typeStr: string): unknown {
  const sql = `EXPLAIN AST json = 1 CREATE TABLE t (c ${typeStr}) ENGINE = Null`;
  const out = spawnSync(
    clickhouse,
    ["local", "--format", "TSVRaw", "-q", sql],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
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

/// The standalone parser's JSON AST for a type string. Throws if the parser
/// rejects the input.
export function toolDataType(typeStr: string): unknown {
  const result = parseDataType(typeStr);
  if (!result.ok()) {
    throw new Error(`parse failed: ${result.error!.message}`);
  }
  return JSON.parse(toJSON(result.ast!));
}
