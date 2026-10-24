import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { type ClickHouseClient } from "@clickhouse/client-common";
import { createTestClient } from "../utils";

// query() sends the SQL as written and passes its format as the
// `default_format` setting, instead of appending a FORMAT clause.
describe("query() with default_format", () => {
  let client: ClickHouseClient;
  afterEach(async () => {
    await client.close();
  });
  beforeEach(async () => {
    client = createTestClient();
  });

  // https://github.com/ClickHouse/clickhouse-js/issues/973
  it.each([
    "SELECT 13 AS a; -- trailing comment",
    "SELECT 13 AS a;\n-- trailing comment",
    "SELECT 13 AS a; /* trailing comment */",
    "SELECT 13 AS a; # trailing comment",
    "SELECT 13 AS a;;;",
  ])("accepts a trailing semicolon and comment: %j", async (query) => {
    const rs = await client.query({ query, format: "JSONEachRow" });
    expect(await rs.json()).toEqual([{ a: 13 }]);
  });

  it("keeps a semicolon inside a string literal", async () => {
    const rs = await client.query({
      query: "SELECT ';' AS a; -- trailing comment",
      format: "JSONEachRow",
    });
    expect(await rs.json()).toEqual([{ a: ";" }]);
  });

  // https://github.com/ClickHouse/clickhouse-js/issues/970
  it("accepts a trailing SETTINGS clause", async () => {
    const rs = await client.query({
      // Only settings that ClickHouse Cloud lets users change.
      query: `DESC format(JSONEachRow, '{"id": 1, "age": 25}') SETTINGS schema_inference_hints = 'age UInt8', schema_inference_make_columns_nullable = 0`,
      format: "JSONEachRow",
    });
    const columns = await rs.json<{ name: string; type: string }>();
    expect(columns.map(({ name, type }) => ({ name, type }))).toEqual([
      { name: "id", type: "Int64" },
      { name: "age", type: "UInt8" },
    ]);
  });

  // https://github.com/ClickHouse/clickhouse-js/issues/759
  it("accepts the short SHOW ROW POLICIES syntax", async () => {
    const rs = await client.query({
      query: "SHOW ROW POLICIES",
      format: "JSONEachRow",
    });
    expect(Array.isArray(await rs.json())).toBe(true);
  });

  it("uses the format argument over a default_format setting", async () => {
    const rs = await client.query({
      query: "SELECT 1 AS a",
      format: "JSONEachRow",
      clickhouse_settings: { default_format: "CSV" },
    });
    expect(await rs.json()).toEqual([{ a: 1 }]);
  });

  describe("a FORMAT clause in the query", () => {
    it("throws when it differs from the format option", async () => {
      await expect(
        client.query({ query: "SELECT 1 AS a FORMAT CSV", format: "JSON" }),
      ).rejects.toThrow(/responded in the CSV format.*JSON format/s);
    });

    it("is accepted when it matches the format option", async () => {
      const rs = await client.query({
        query: "SELECT 1 AS a FORMAT JSONEachRow",
        format: "JSONEachRow",
      });
      expect(await rs.json()).toEqual([{ a: 1 }]);
    });
  });

  it("works when the query is sent as a multipart body", async () => {
    const rs = await client.query({
      query: "SELECT {a: UInt8} AS a; -- note",
      format: "JSONEachRow",
      query_params: { a: 7 },
      use_multipart_params: true,
    });
    expect(await rs.json()).toEqual([{ a: 7 }]);
  });

  describe("command() and exec() send the SQL as written", () => {
    it.each([
      "SELECT 1; -- trailing comment",
      "SELECT 1;\n-- trailing comment",
      "SELECT 1;;;",
    ])("command(): %j", async (query) => {
      await expect(client.command({ query })).resolves.toBeDefined();
    });

    it("exec(): a trailing semicolon and comment", async () => {
      const { stream } = await client.exec({
        query: "SELECT 13 AS a; -- trailing comment",
        clickhouse_settings: { default_format: "JSONEachRow" },
      });
      expect(await readText(stream)).toEqual('{"a":13}\n');
    });
  });
});

// exec() returns a Node.js or a Web stream, depending on the client.
async function readText(stream: unknown): Promise<string> {
  const chunks: Uint8Array[] = [];
  if (stream instanceof ReadableStream) {
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } else {
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
  }
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(bytes);
}
