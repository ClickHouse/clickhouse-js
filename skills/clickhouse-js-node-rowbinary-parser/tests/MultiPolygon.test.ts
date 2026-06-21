import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { NeedMoreData, RowBinaryState } from "../src/core.js";
import { readMultiPolygon } from "../src/geo.js";

async function reader(expr: string): Promise<RowBinaryState> {
  return new RowBinaryState(await query(`SELECT ${expr} FORMAT RowBinary`));
}

describe("readMultiPolygon", () => {
  it("decodes a MultiPolygon as an array of polygons", async () => {
    const r = await reader(
      "CAST([[[(0, 0), (1, 0), (1, 1)]]] AS MultiPolygon)",
    );
    expect(readMultiPolygon(r)).toEqual([
      [
        [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      ],
    ]);
  });

  describe("advance() edge cases", () => {
    it("throws NeedMoreData for every incomplete prefix (0 .. full.length-1)", async () => {
      const full = await query(
        "SELECT CAST([[[(0, 0), (1, 0), (1, 1)]]] AS MultiPolygon) FORMAT RowBinary",
      );
      for (let len = 0; len < full.length; len++) {
        const r = new RowBinaryState(full.subarray(0, len));
        let thrown: unknown;
        try {
          readMultiPolygon(r);
        } catch (e) {
          thrown = e;
        }
        expect(thrown, `prefix length ${len} of ${full.length}`).toBe(
          NeedMoreData,
        );
      }
    });
  });
});
