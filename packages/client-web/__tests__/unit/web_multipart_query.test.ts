import { describe, it, expect, beforeEach, vi } from "vitest";
import { ClickHouseLogLevel, LogWriter } from "@clickhouse/client-common";
import { TestLogger } from "../../../client-common/__tests__/utils/test_logger";
import { WebConnection, type WebConnectionParams } from "../../src/connection";

beforeEach(() => {
  vi.clearAllMocks();
});

// A minimal fetch stub that always resolves with a successful, empty response
// and records the (url, init) it was called with.
function stubFetch() {
  return vi.fn(async () => ({
    status: 200,
    body: null,
    headers: new Headers({ "x-clickhouse-query-id": "test-query-id" }),
  })) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
}

function buildWebConnection(
  config: Partial<WebConnectionParams> & { fetch: typeof fetch },
) {
  return new WebConnection({
    url: new URL("https://localhost:8443"),
    request_timeout: 30_000,
    compression: {
      decompress_response: false,
      compress_request: false,
    },
    max_open_connections: 10,
    auth: { username: "default", password: "", type: "Credentials" },
    database: "default",
    clickhouse_settings: {},
    log_writer: new LogWriter(
      new TestLogger(),
      "WebConnectionTest",
      ClickHouseLogLevel.OFF,
    ),
    log_level: ClickHouseLogLevel.OFF,
    keep_alive: { enabled: false },
    ...config,
  });
}

// Helper: the recorded fetch call as [url, init].
function lastFetchCall(fetchStub: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
  const headers = init.headers as Record<string, string>;
  return { url, init, headers };
}

describe("[Web] Multipart query params", () => {
  describe("when use_multipart_params is true", () => {
    it("should move query_params from URL into the multipart body", async () => {
      const fetchStub = stubFetch();
      const adapter = buildWebConnection({
        use_multipart_params: true,
        fetch: fetchStub,
      });

      await adapter.query({
        query: "SELECT * FROM t WHERE x IN {values:Array(String)}",
        query_params: { values: ["a@b.com", "c@d.com"] },
      });

      const { url, headers } = lastFetchCall(fetchStub);
      // params live in the body, not the URL
      expect(url).not.toContain("param_values");
      expect(url).toContain("query_id=");
      // Content-Type announces multipart with a clickhouse-js boundary
      expect(headers["Content-Type"]).toMatch(
        /^multipart\/form-data; boundary=----clickhouse-js-/,
      );
    });

    it("should keep non-param search params (database, query_id, session_id, settings) in URL", async () => {
      const fetchStub = stubFetch();
      const adapter = buildWebConnection({
        database: "my_db",
        use_multipart_params: true,
        fetch: fetchStub,
      });

      await adapter.query({
        query: "SELECT {v:Int32}",
        query_params: { v: 42 },
        session_id: "my-session",
        clickhouse_settings: { extremes: 1 },
      });

      const { url } = lastFetchCall(fetchStub);
      expect(url).toContain("query_id=");
      expect(url).toContain("database=my_db");
      expect(url).toContain("extremes=1");
      expect(url).toContain("session_id=my-session");
      expect(url).not.toContain("param_v");
    });

    it("should fall back to normal behavior when query_params is undefined", async () => {
      const fetchStub = stubFetch();
      const adapter = buildWebConnection({
        use_multipart_params: true,
        fetch: fetchStub,
      });

      await adapter.query({ query: "SELECT 1" });

      const { headers } = lastFetchCall(fetchStub);
      expect(headers["Content-Type"]).toBeUndefined();
    });

    it("should fall back to normal behavior when query_params is empty object", async () => {
      const fetchStub = stubFetch();
      const adapter = buildWebConnection({
        use_multipart_params: true,
        fetch: fetchStub,
      });

      await adapter.query({ query: "SELECT 1", query_params: {} });

      const { headers } = lastFetchCall(fetchStub);
      expect(headers["Content-Type"]).toBeUndefined();
    });
  });

  describe("when use_multipart_params is false (default)", () => {
    it("should send query_params as URL search params", async () => {
      const fetchStub = stubFetch();
      const adapter = buildWebConnection({
        use_multipart_params: false,
        fetch: fetchStub,
      });

      await adapter.query({
        query: "SELECT {v:Int32}",
        query_params: { v: 42 },
      });

      const { url, headers } = lastFetchCall(fetchStub);
      expect(url).toContain("param_v=42");
      expect(headers["Content-Type"]).toBeUndefined();
    });
  });

  describe("per-request use_multipart_params override", () => {
    it("should enable multipart for a request when the client default is false", async () => {
      const fetchStub = stubFetch();
      const adapter = buildWebConnection({
        use_multipart_params: false,
        fetch: fetchStub,
      });

      await adapter.query({
        query: "SELECT {v:Int32}",
        query_params: { v: 42 },
        use_multipart_params: true,
      });

      const { url, headers } = lastFetchCall(fetchStub);
      expect(url).not.toContain("param_v");
      expect(headers["Content-Type"]).toMatch(
        /^multipart\/form-data; boundary=/,
      );
    });

    it("should disable multipart for a request when the client default is true", async () => {
      const fetchStub = stubFetch();
      const adapter = buildWebConnection({
        use_multipart_params: true,
        fetch: fetchStub,
      });

      await adapter.query({
        query: "SELECT {v:Int32}",
        query_params: { v: 42 },
        use_multipart_params: false,
      });

      const { url, headers } = lastFetchCall(fetchStub);
      expect(url).toContain("param_v=42");
      expect(headers["Content-Type"]).toBeUndefined();
    });
  });
});
