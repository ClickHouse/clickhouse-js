import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { server } from "vitest/browser";
import { isClickHouseVersionAtLeast } from "@test/utils/server_version";
import { ClickHouseError } from "@clickhouse/client-web";
import type { ClickHouseClient } from "@clickhouse/client-web";
import { createWebTestClient } from "../utils/web_client";

// See https://github.com/ClickHouse/clickhouse-js/issues/607
describe("[Web] ResultSet.binaryStream() and rawStream()", () => {
  let client: ClickHouseClient;
  beforeEach(async () => {
    client = createWebTestClient();
  });
  afterEach(async () => {
    await client.close();
  });

  // The hashes give `\r\n` pairs in the Parquet bytes.
  const query = "SELECT number, sipHash128(number) AS h FROM numbers(100000)";

  async function readAll(stream: ReadableStream<Uint8Array>) {
    const chunks: Uint8Array[] = [];
    let error: unknown;
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } catch (err) {
      error = err;
    }
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return { bytes, error };
  }

  async function execBytes(sql: string): Promise<Uint8Array> {
    const { stream } = await client.exec({ query: `${sql} FORMAT Parquet` });
    return (await readAll(stream)).bytes;
  }

  function countCRLF(bytes: Uint8Array): number {
    let count = 0;
    for (let i = 1; i < bytes.length; i++) {
      if (bytes[i] === 0x0a && bytes[i - 1] === 0x0d) count++;
    }
    return count;
  }

  it("gives the same Parquet bytes as exec()", async () => {
    const expected = await execBytes(query);
    expect(countCRLF(expected)).toBeGreaterThan(0);

    const rs = await client.query({ query, format: "Parquet" });
    const { bytes, error } = await readAll(rs.binaryStream());
    expect(error).toBeUndefined();
    expect(bytes).toEqual(expected);
  });

  it("gives the server error after a part of the Parquet result", async ({
    skip,
  }) => {
    // Chromium sometimes drops the bytes that the reader has not read yet
    // when the server closes the connection after the exception block. Then
    // the read fails with `TypeError: network error`. See
    // https://github.com/ClickHouse/clickhouse-js/issues/1140
    if (server.browser === "chromium") {
      skip();
    }
    if (!(await isClickHouseVersionAtLeast(client, 25, 11))) {
      skip();
    }
    const rs = await client.query({
      query:
        "SELECT number, sipHash128(number) AS h, throwIf(number = 90000) AS t FROM numbers(100000)",
      format: "Parquet",
      clickhouse_settings: {
        max_block_size: "1000",
        max_threads: 1,
        output_format_parquet_row_group_size: "1000",
      },
    });
    const { bytes, error } = await readAll(rs.binaryStream());
    expect(error).toBeInstanceOf(ClickHouseError);
    expect((error as ClickHouseError).code).toBe("395");
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("PAR1");
  });

  it("rawStream() gives the bytes of the server as they are", async () => {
    const expected = await execBytes(query);
    const rs = await client.query({ query, format: "Parquet" });
    const { bytes, error } = await readAll(rs.rawStream());
    expect(error).toBeUndefined();
    expect(bytes).toEqual(expected);
  });
});
