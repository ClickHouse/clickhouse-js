/// Snapshot test: compare the standalone parser against the static oracle
/// snapshots in test/snapshots/ — NO `clickhouse` binary required.
///
/// Each snapshot holds the `data_type` subtree the real server emitted for a
/// type in cases.txt (captured by update_snapshots.ts). Since a snapshot is
/// only written when the server accepted the type AND the parser matched it,
/// "parser output equals snapshot" is equivalent to "parser equals server".
///
/// Run with: npm test   (vitest run)

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { canon, readCases } from "./cases.js";
import { toolDataType } from "./oracle.js";
import { snapshotPath, type Snapshot } from "./snapshots.js";

const here = dirname(fileURLToPath(import.meta.url));
const cases = readCases(join(here, "cases.txt"));

describe("snapshot corpus", () => {
  it("is non-empty", () => {
    expect(cases.length, "cases.txt has no cases").toBeGreaterThan(0);
  });

  for (const typeStr of cases) {
    it(`matches server snapshot: ${typeStr}`, () => {
      const path = snapshotPath(typeStr);
      expect(
        existsSync(path),
        `missing snapshot for ${JSON.stringify(typeStr)} — run: npm run snapshot:update -- --clickhouse <path>`,
      ).toBe(true);
      const snap = JSON.parse(readFileSync(path, "utf8")) as Snapshot;
      const expected = canon(snap.data_type);
      const actual = canon(toolDataType(typeStr));
      expect(actual).toEqual(expected);
    });
  }
});
