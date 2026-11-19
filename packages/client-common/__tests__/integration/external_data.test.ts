import { describe, it, expect, afterEach } from "vitest";
import { type ClickHouseClient } from "@clickhouse/client-common";
import { createTestClient, guid } from "../utils";

describe("external_data (temporary table per query)", () => {
  let client: ClickHouseClient;

  afterEach(async () => {
    if (client) {
      await client.close();
    }
  });

  it("queries an external table with structure (string and array) and default/TSV format", async () => {
    client = createTestClient();

    const rsString = await client.query({
      query: "SELECT id, n FROM ext ORDER BY n",
      format: "JSONEachRow",
      external_data: [
        {
          name: "ext",
          structure: "id String, n UInt32",
          data: "alpha\t10\nbeta\t20\n",
        },
      ],
    });
    expect(await rsString.json()).toEqual([
      { id: "alpha", n: 10 },
      { id: "beta", n: 20 },
    ]);

    const rsArray = await client.query({
      query: "SELECT id, label, n FROM ext ORDER BY n",
      format: "JSONEachRow",
      external_data: [
        {
          name: "ext",
          structure: ["id String", "label Nullable(String)", "n UInt32"],
          format: "TSV",
          data: "m1\thello\\tworld\\nline2\t1\nm2\t\\N\t2\n",
        },
      ],
    });
    expect(await rsArray.json()).toEqual([
      { id: "m1", label: "hello\tworld\nline2", n: 1 },
      { id: "m2", label: null, n: 2 },
    ]);
  });

  it("supports positional types (string and array) with CSV, JSONEachRow, and JSONCompactEachRow", async () => {
    client = createTestClient();

    const csvRs = await client.query({
      query:
        "SELECT _1 AS name, _2 AS flag, _3 AS note FROM ext_csv ORDER BY _1",
      format: "JSONEachRow",
      external_data: [
        {
          name: "ext_csv",
          types: ["String", "Bool", "Nullable(String)"],
          format: "CSV",
          data: '"alice, ""jr""",true,\\N\n"bob",false,"line1\nline2"\n',
        },
      ],
    });
    expect(await csvRs.json()).toEqual([
      { name: 'alice, "jr"', flag: true, note: null },
      { name: "bob", flag: false, note: "line1\nline2" },
    ]);

    const jsonRs = await client.query({
      query: "SELECT id, tags FROM ext_json ORDER BY id",
      format: "JSONEachRow",
      external_data: [
        {
          name: "ext_json",
          structure: "id UInt32, tags Array(String)",
          format: "JSONEachRow",
          data: [
            { id: 1, tags: ["a", "b"] },
            { id: 2, tags: ["c"] },
          ],
        },
      ],
    });
    expect(await jsonRs.json()).toEqual([
      { id: 1, tags: ["a", "b"] },
      { id: 2, tags: ["c"] },
    ]);

    const compactRs = await client.query({
      query: "SELECT _1 AS k, _2 AS v FROM ext_compact ORDER BY v",
      format: "JSONEachRow",
      external_data: [
        {
          name: "ext_compact",
          types: "String, UInt32",
          format: "JSONCompactEachRow",
          data: [
            ["k1", 100],
            ["k2", 200],
          ],
        },
      ],
    });
    expect(await compactRs.json()).toEqual([
      { k: "k1", v: 100 },
      { k: "k2", v: 200 },
    ]);
  });

  it("joins several external tables in a single query alongside query_params and binary Uint8Array data", async () => {
    client = createTestClient({ use_multipart_params_auto: true });

    const weightsBytes = new TextEncoder().encode("m1\t2\nm2\t5\nm3\t10\n");
    const rs = await client.query({
      query: `
        SELECT m.id AS id, m.reading * w.weight AS weighted
        FROM meters AS m
        INNER JOIN weights AS w ON m.id = w.id
        WHERE m.reading >= {min_reading:UInt32}
        ORDER BY m.id
      `,
      format: "JSONEachRow",
      query_params: { min_reading: 15 },
      external_data: [
        {
          name: "meters",
          structure: "id String, reading UInt32",
          format: "JSONEachRow",
          data: [
            { id: "m1", reading: 10 },
            { id: "m2", reading: 20 },
            { id: "m3", reading: 30 },
          ],
        },
        {
          name: "weights",
          structure: "id String, weight UInt32",
          format: "TSV",
          data: weightsBytes,
        },
      ],
    });

    expect(await rs.json()).toEqual([
      { id: "m2", weighted: "100" },
      { id: "m3", weighted: "300" },
    ]);
  });

  it("joins an external table of 100k+ ids in one request under ClickHouse default settings", async () => {
    client = createTestClient();

    const rowCount = 120_000;
    const ids = new Array<string>(rowCount);
    for (let i = 0; i < rowCount; i++) {
      // ~20 bytes per ID -> >2.4 MiB payload, well above default 128 KiB http_max_field_value_size
      ids[i] = `meter_${String(i * 2).padStart(10, "0")}`;
    }

    const rs = await client.query({
      query: `
        SELECT
          count() AS matched,
          min(n.number) AS min_num,
          max(n.number) AS max_num,
          toString(getSetting('http_max_field_value_size')) AS field_cap
        FROM (
          SELECT number, concat('meter_', leftPad(toString(number), 10, '0')) AS id
          FROM numbers(250000)
        ) AS n
        INNER JOIN selected_meters AS s ON n.id = s.id
      `,
      format: "JSONEachRow",
      external_data: [
        {
          name: "selected_meters",
          structure: "id String",
          format: "TSV",
          data: ids.join("\n") + "\n",
        },
      ],
    });

    const rows = await rs.json<{
      matched: string;
      min_num: string;
      max_num: string;
      field_cap: string;
    }>();
    expect(rows).toEqual([
      {
        matched: String(rowCount),
        min_num: "0",
        max_num: String((rowCount - 1) * 2),
        // Confirms default 128 KiB setting was NOT raised
        field_cap: "131072",
      },
    ]);
  });

  it("supports external_data in command()", async () => {
    const sessionId = `ext_cmd_${guid()}`;
    client = createTestClient({ session_id: sessionId });

    await client.command({
      query: "CREATE TEMPORARY TABLE saved_ext AS SELECT id, v FROM seed_ext",
      external_data: [
        {
          name: "seed_ext",
          structure: "id String, v UInt32",
          format: "JSONEachRow",
          data: [
            { id: "x", v: 7 },
            { id: "y", v: 9 },
          ],
        },
      ],
    });

    const rs = await client.query({
      query: "SELECT id, v FROM saved_ext ORDER BY v",
      format: "JSONEachRow",
    });
    expect(await rs.json()).toEqual([
      { id: "x", v: 7 },
      { id: "y", v: 9 },
    ]);
  });
});
