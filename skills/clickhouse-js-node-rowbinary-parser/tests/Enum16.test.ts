import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { NeedMoreData, Cursor } from "../src/core.js";
import { readEnum16 } from "../src/enums.js";

async function reader(expr: string): Promise<Cursor> {
  return new Cursor(await query(`SELECT ${expr} FORMAT RowBinary`));
}

describe("readEnum16", () => {
  it("decodes a 16-bit underlying value", async () => {
    const r = await reader("CAST('big' AS Enum16('small' = 1, 'big' = 300))");
    const value = readEnum16(r);
    expect(value).toBe(300);
    expect(r.pos).toBe(2);
  });

  it("decodes a negative enum value", async () => {
    const value = readEnum16(
      await reader("CAST('lo' AS Enum16('lo' = -1000, 'hi' = 1000))"),
    );
    expect(value).toBe(-1000);
  });

  describe("advance() edge cases", () => {
    it("throws NeedMoreData for every incomplete prefix (0 .. full.length-1)", async () => {
      const full = await query(
        "SELECT CAST('big' AS Enum16('small' = 1, 'big' = 300)) FORMAT RowBinary",
      );
      for (let len = 0; len < full.length; len++) {
        const r = new Cursor(full.subarray(0, len));
        let thrown: unknown;
        try {
          readEnum16(r);
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
