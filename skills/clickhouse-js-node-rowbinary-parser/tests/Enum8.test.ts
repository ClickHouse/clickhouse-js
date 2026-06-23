import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { NeedMoreData, Cursor } from "../src/core.js";
import { readEnum8 } from "../src/enums.js";

async function reader(expr: string): Promise<Cursor> {
  return new Cursor(await query(`SELECT ${expr} FORMAT RowBinary`));
}

describe("readEnum8", () => {
  it("decodes the underlying value and resolves the name via a lookup", async () => {
    const r = await reader("CAST('b' AS Enum8('a' = 1, 'b' = 2))");
    const value = readEnum8(r);
    expect(value).toBe(2);
    expect(r.pos).toBe(1);
    // The name map comes from the column's type definition, not the wire.
    const NAMES: Record<number, string> = { 1: "a", 2: "b" };
    expect(NAMES[value]).toBe("b");
  });

  it("decodes a negative enum value", async () => {
    const value = readEnum8(
      await reader("CAST('x' AS Enum8('x' = -1, 'y' = 2))"),
    );
    expect(value).toBe(-1);
  });

  describe("advance() edge cases", () => {
    it("throws NeedMoreData for every incomplete prefix (0 .. full.length-1)", async () => {
      const full = await query(
        "SELECT CAST('b' AS Enum8('a' = 1, 'b' = 2)) FORMAT RowBinary",
      );
      for (let len = 0; len < full.length; len++) {
        const r = new Cursor(full.subarray(0, len));
        let thrown: unknown;
        try {
          readEnum8(r);
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
