import { describe, it, expect, afterEach, beforeEach } from "vitest";
import * as lexer from "@clickhouse/lexer";
import {
  ClickHouseError,
  type ClickHouseClient,
} from "@clickhouse/client-common";
import { createTestClient } from "../utils";
import {
  KNOWN_DIFFERENCES,
  sqlCorpus,
  sqlLexerModes,
} from "../utils/sql_corpus";

describe("sql_lexer", () => {
  let client: ClickHouseClient;
  afterEach(async () => {
    await client.close();
  });
  beforeEach(async () => {
    client = createTestClient({ sql_lexer: lexer });
  });

  // https://github.com/ClickHouse/clickhouse-js/issues/973
  it.each([
    "SELECT 13 AS a; -- trailing comment",
    "SELECT 13 AS a;\n-- trailing comment",
    "SELECT 13 AS a; /* trailing comment */",
    "SELECT 13 AS a; # trailing comment",
  ])("query() accepts a semicolon before a comment: %j", async (query) => {
    const rs = await client.query({ query, format: "JSONEachRow" });
    expect(await rs.json()).toEqual([{ a: 13 }]);
  });

  it("query() keeps a semicolon inside a string literal", async () => {
    const rs = await client.query({
      query: "SELECT ';' AS a; -- trailing comment",
      format: "JSONEachRow",
    });
    expect(await rs.json()).toEqual([{ a: ";" }]);
  });

  // https://github.com/ClickHouse/clickhouse-js/issues/970
  it("query() puts FORMAT before a trailing SETTINGS clause", async () => {
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

  it("command() accepts a semicolon before a comment", async () => {
    await expect(
      client.command({ query: "SELECT 1; -- trailing comment" }),
    ).resolves.toBeDefined();
  });
});

// The same corpus as ../unit/sql_rewriting_vs_lexer.test.ts, judged by the
// server. The expected answer comes from exec(), which sends the query as
// written apart from removing trailing semicolons (which the server ignores),
// with the format set through `default_format` instead of a FORMAT clause.
describe("query() gets the server's answer for the original query", () => {
  const clients = new Map<string, ClickHouseClient>();
  let plain: ClickHouseClient;
  beforeEach(() => {
    plain = createTestClient();
    for (const [mode, config] of sqlLexerModes) {
      clients.set(mode, createTestClient(config));
    }
  });
  afterEach(async () => {
    await plain.close();
    for (const c of clients.values()) {
      await c.close();
    }
    clients.clear();
  });

  it.each(sqlCorpus)("%j", async (sql) => {
    const expected = await answer(async () => {
      const { stream } = await plain.exec({
        query: sql,
        clickhouse_settings: { default_format: "JSONEachRow" },
      });
      return readText(stream);
    });
    for (const [mode, client] of clients) {
      // A known difference may or may not change the server's answer.
      if (mode === sqlLexerModes[0]![0] && sql in KNOWN_DIFFERENCES.query) {
        continue;
      }
      const actual = await answer(async () => {
        const rs = await client.query({ query: sql, format: "JSONEachRow" });
        return rs.text();
      });
      expect(actual, mode).toEqual(expected);
    }
  });
});

/** The response text, or the server's error type. */
async function answer(
  run: () => Promise<string>,
): Promise<{ text: string } | { error: string | undefined }> {
  try {
    return { text: await run() };
  } catch (err) {
    if (err instanceof ClickHouseError) {
      return { error: err.type };
    }
    throw err;
  }
}

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
