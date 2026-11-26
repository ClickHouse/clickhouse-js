import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { isClickHouseVersionAtLeast } from "@test/utils/server_version";
import { ClickHouseError } from "@clickhouse/client";
import type { ClickHouseClient } from "@clickhouse/client";
import { createNodeTestClient } from "../utils/node_client";

// See https://github.com/ClickHouse/clickhouse-js/issues/607
describe("[Node.js] ResultSet.binaryStream() and rawStream()", () => {
  let client: ClickHouseClient;
  beforeEach(async () => {
    client = createNodeTestClient();
  });
  afterEach(async () => {
    await client.close();
  });

  // The hashes give `\r\n` pairs in the Parquet bytes.
  const query = "SELECT number, sipHash128(number) AS h FROM numbers(100000)";
  // The server sends a part of the result, then the exception block, and
  // then it closes the connection.
  const failingQuery =
    "SELECT number, sipHash128(number) AS h, throwIf(number = 90000) AS t FROM numbers(100000)";
  const failingSettings = {
    max_block_size: "1000",
    max_threads: 1,
    output_format_parquet_row_group_size: "1000",
  };

  async function readAll(stream: AsyncIterable<Buffer>) {
    const chunks: Buffer[] = [];
    let error: unknown;
    try {
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
    } catch (err) {
      error = err;
    }
    return { bytes: Buffer.concat(chunks), error };
  }

  async function execBytes(sql: string): Promise<Buffer> {
    const { stream } = await client.exec({ query: `${sql} FORMAT Parquet` });
    return (await readAll(stream)).bytes;
  }

  function countCRLF(bytes: Buffer): number {
    let count = 0;
    for (
      let i = bytes.indexOf("\r\n");
      i !== -1;
      i = bytes.indexOf("\r\n", i + 1)
    ) {
      count++;
    }
    return count;
  }

  it("gives the same Parquet bytes as exec()", async () => {
    const expected = await execBytes(query);
    expect(countCRLF(expected)).toBeGreaterThan(0);

    const rs = await client.query({ query, format: "Parquet" });
    const { bytes, error } = await readAll(rs.binaryStream());
    expect(error).toBeUndefined();
    expect(bytes.equals(expected)).toBe(true);
  });

  it("gives the server error after a part of the Parquet result", async ({
    skip,
  }) => {
    if (!(await isClickHouseVersionAtLeast(client, 25, 11))) {
      skip();
    }
    const rs = await client.query({
      query: failingQuery,
      format: "Parquet",
      clickhouse_settings: failingSettings,
    });
    const { bytes, error } = await readAll(rs.binaryStream());
    expect(error).toBeInstanceOf(ClickHouseError);
    expect((error as ClickHouseError).code).toBe("395");
    expect((error as ClickHouseError).type).toBe(
      "FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
    );
    expect(bytes.subarray(0, 4).toString()).toBe("PAR1");
    expect(bytes.includes("__exception__")).toBe(false);
  });

  it("rawStream() gives the bytes of the server as they are", async () => {
    const expected = await execBytes(query);
    const rs = await client.query({ query, format: "Parquet" });
    const { bytes, error } = await readAll(rs.rawStream());
    expect(error).toBeUndefined();
    expect(bytes.equals(expected)).toBe(true);
  });
});
