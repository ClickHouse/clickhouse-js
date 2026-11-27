import type { ClickHouseClient } from "@clickhouse/client-common";
import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { createTableWithFields } from "@test/fixtures/table_with_fields";
import { createTestClient } from "@test/utils/client";

// Minimal reproduction for https://github.com/ClickHouse/clickhouse-js/issues/837
// Inserting raw binary buffer data into a String/FixedString field via
// JSONEachRow does not work: the JSON value is interpreted as UTF-8 text, so
// any byte >= 0x80 is re-encoded into a multi-byte UTF-8 sequence. For a
// FixedString this overflows the declared size (TOO_LARGE_STRING_SIZE), and
// even for a plain String the stored bytes no longer match the original ones.
describe("[Node.js] insert binary buffer into String/FixedString (#837)", () => {
  let client: ClickHouseClient;
  beforeEach(() => {
    client = createTestClient();
  });
  afterEach(async () => {
    await client.close();
  });

  it("cannot insert raw binary buffer data into FixedString via JSONEachRow", async () => {
    const table = await createTableWithFields(client, "fs FixedString(2)");
    // Two bytes that fit into FixedString(2) as raw bytes, but each 0xF0 byte
    // becomes 0xC3 0xB0 once re-encoded as UTF-8 text, overflowing the field.
    const binary = Buffer.from([0xf0, 0xf0]);
    await expect(
      client.insert({
        table,
        values: [{ fs: binary.toString("binary") }],
        format: "JSONEachRow",
      }),
    ).rejects.toMatchObject(
      expect.objectContaining({
        type: "TOO_LARGE_STRING_SIZE",
        message: expect.stringContaining("Too large value for FixedString(2)"),
      }),
    );
  });

  it("silently corrupts binary buffer data inserted into String via JSONEachRow", async () => {
    const table = await createTableWithFields(client, "s String");
    const binary = Buffer.from([0xf0, 0xf0]);
    await client.insert({
      table,
      values: [{ id: 1, s: binary.toString("binary") }],
      format: "JSONEachRow",
    });
    const [{ stored }] = await client
      .query({
        query: `SELECT hex(s) AS stored FROM ${table}`,
        format: "JSONEachRow",
      })
      .then((r) => r.json<{ stored: string }>());
    // The original bytes were F0F0, but `toString("binary")` maps each byte to
    // a Latin-1 code point that is then re-encoded as UTF-8 on the way in
    // (0xF0 -> U+00F0 -> 0xC3 0xB0), so the round-tripped value no longer
    // matches the input buffer.
    expect(stored).not.toBe("F0F0");
    expect(stored).toBe("C3B0C3B0");
  });
});
