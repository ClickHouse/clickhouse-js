import { describe, it, expect, beforeEach, vi } from "vitest";
import { ClickHouseLogLevel, LogWriter } from "@clickhouse/client-common";
import { TestLogger } from "../../../client-common/__tests__/utils/test_logger";
import { WebConnection, type WebConnectionParams } from "../../src/connection";

beforeEach(() => {
  vi.clearAllMocks();
});

const SUMMARY = {
  read_rows: "6568",
  read_bytes: "3894304",
  written_rows: "0",
  written_bytes: "0",
  total_rows_to_read: "6568",
  result_rows: "0",
  result_bytes: "0",
  elapsed_ns: "10693523",
  memory_usage: "4580679",
};

function stubFetch(headers: Record<string, string>) {
  return vi.fn(async () => ({
    status: 200,
    body: null,
    text: async () => "",
    headers: new Headers({
      "x-clickhouse-query-id": "test-query-id",
      ...headers,
    }),
  })) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
}

function buildWebConnection(fetch: typeof fetch): WebConnection {
  return new WebConnection({
    url: new URL("https://localhost:8443"),
    request_timeout: 30_000,
    compression: {
      decompress_response: undefined,
      compress_request: undefined,
    },
    max_open_connections: 10,
    auth: { username: "default", password: "", type: "Credentials" },
    database: "default",
    clickhouse_settings: {},
    log_writer: new LogWriter(
      new TestLogger(),
      "WebSummaryTest",
      ClickHouseLogLevel.OFF,
    ),
    log_level: ClickHouseLogLevel.OFF,
    keep_alive: { enabled: false },
    fetch,
  } as WebConnectionParams);
}

describe("[Web] X-ClickHouse-Summary parsing", () => {
  it("parses the summary header for query()", async () => {
    const conn = buildWebConnection(
      stubFetch({ "x-clickhouse-summary": JSON.stringify(SUMMARY) }),
    );
    const result = await conn.query({ query: "SELECT 1" });
    expect(result.summary).toEqual(SUMMARY);
  });

  it("parses the summary header for insert()", async () => {
    const conn = buildWebConnection(
      stubFetch({ "x-clickhouse-summary": JSON.stringify(SUMMARY) }),
    );
    const result = await conn.insert({ query: "INSERT INTO t", values: "" });
    expect(result.summary).toEqual(SUMMARY);
  });

  it("parses the summary header for command()", async () => {
    const conn = buildWebConnection(
      stubFetch({ "x-clickhouse-summary": JSON.stringify(SUMMARY) }),
    );
    const result = await conn.command({ query: "CREATE TABLE t (a UInt8)" });
    expect(result.summary).toEqual(SUMMARY);
  });

  it("returns undefined summary when the header is absent", async () => {
    const conn = buildWebConnection(stubFetch({}));
    const result = await conn.query({ query: "SELECT 1" });
    expect(result.summary).toBeUndefined();
  });

  it("returns undefined summary (and does not throw) when the header is malformed", async () => {
    const conn = buildWebConnection(
      stubFetch({ "x-clickhouse-summary": "not-json{" }),
    );
    const result = await conn.query({ query: "SELECT 1" });
    expect(result.summary).toBeUndefined();
  });
});
