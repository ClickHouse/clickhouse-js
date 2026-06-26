/// Shared helpers for the oracle / unsupported test harnesses.

import { readFileSync } from "node:fs";

/// Read a cases file: one type per line, blank lines and #-comments ignored.
export function readCases(path: string): string[] {
  const cases: string[] = [];
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (line && !line.startsWith("#")) cases.push(line);
  }
  return cases;
}

/// Recursively sort object keys so comparison ignores key order (mirrors the
/// Python oracle's `canon`).
export function canon(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canon);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canon((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}
