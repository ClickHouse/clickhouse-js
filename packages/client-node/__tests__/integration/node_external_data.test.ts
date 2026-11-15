import { describe, it, expect, afterEach } from "vitest";
import Fs from "node:fs";
import Stream from "node:stream";
import type { ClickHouseClient } from "../../src";
import { createTestClient } from "@test/utils";
import { getAsText } from "../../src/utils";

describe("[Node.js] external_data integration", () => {
  let client: ClickHouseClient;

  afterEach(async () => {
    if (client) {
      await client.close();
    }
  });

  it("streams external_data from Buffer, Readable byte stream, object-mode JSON stream, and Parquet file stream", async () => {
    client = createTestClient();

    const buf = Buffer.from("m1\t100\nm2\t200\n", "utf8");
    const objectJsonStream = Stream.Readable.from(
      [
        { id: "m1", factor: 2 },
        { id: "m2", factor: 3 },
      ],
      { objectMode: true },
    );

    const rs = await client.query({
      query: `
        SELECT b.id AS id, b.val * j.factor AS total
        FROM ext_buf AS b
        INNER JOIN ext_stream AS j ON b.id = j.id
        ORDER BY b.id
      `,
      format: "JSONEachRow",
      external_data: [
        {
          name: "ext_buf",
          structure: "id String, val UInt32",
          format: "TSV",
          data: buf,
        },
        {
          name: "ext_stream",
          structure: "id String, factor UInt32",
          format: "JSONEachRow",
          data: objectJsonStream,
        },
      ],
    });

    expect(await rs.json()).toEqual([
      { id: "m1", total: "200" },
      { id: "m2", total: "600" },
    ]);

    // Parquet file stream + Buffer
    const parquetPath =
      "packages/client-common/__tests__/fixtures/streaming_e2e_data.parquet";
    const parquetRs = await client.query({
      query: "SELECT id, name, sku FROM ext_pq ORDER BY id",
      format: "JSONEachRow",
      external_data: [
        {
          name: "ext_pq",
          structure: "id UInt64, name String, sku Array(UInt8)",
          format: "Parquet",
          data: Fs.createReadStream(parquetPath),
        },
      ],
    });
    expect(await parquetRs.json()).toEqual([
      { id: "0", name: "a", sku: [1, 2] },
      { id: "1", name: "b", sku: [3, 4] },
      { id: "2", name: "c", sku: [5, 6] },
    ]);
  });

  it("streams a 100k+ row Readable generator in exec() with request compression enabled on client", async () => {
    client = createTestClient({
      compression: { request: true, response: true },
    });

    const rowCount = 105_000;
    async function* generateTsvChunks() {
      let batch = "";
      for (let i = 0; i < rowCount; i++) {
        batch += `id_${i}\t${i}\n`;
        if ((i + 1) % 5000 === 0) {
          yield batch;
          batch = "";
        }
      }
      if (batch.length > 0) {
        yield batch;
      }
    }

    const execRes = await client.exec({
      query: "SELECT count(), sum(n) FROM big_stream FORMAT TSV",
      external_data: [
        {
          name: "big_stream",
          structure: "id String, n UInt64",
          format: "TSV",
          data: Stream.Readable.from(generateTsvChunks(), {
            objectMode: false,
          }),
        },
      ],
    });

    const expectedSum = (BigInt(rowCount - 1) * BigInt(rowCount)) / 2n;
    expect((await getAsText(execRes.stream)).trim()).toBe(
      `${rowCount}\t${expectedSum}`,
    );
  });
});
