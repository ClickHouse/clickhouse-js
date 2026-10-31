import { describe, it, expect } from "vitest";
import { createSimpleWebTestClient } from "../utils/simple_web_client";

describe("[Web] X-ClickHouse-Format request header", () => {
  // Records the headers of every fetch() call, lower-cased by `Headers`.
  function createClientRecordingHeaders(http_headers: Record<string, string>) {
    const requests: Array<Record<string, string>> = [];
    const mockedFetch: typeof fetch = async (_input, init) => {
      requests.push(Object.fromEntries(new Headers(init?.headers).entries()));
      return new Response("", { status: 200 });
    };
    const client = createSimpleWebTestClient({
      url: "http://localhost:8123",
      fetch: mockedFetch,
      http_headers,
    });
    return { client, requests };
  }

  // The server prefers the header over the `default_format` setting that
  // carries the query() format, so query() does not send it.
  it("is not sent by query(), whichever case it is written in", async () => {
    const { client, requests } = createClientRecordingHeaders({
      "X-ClickHouse-Format": "CSV",
      "From-Instance": "foo",
    });
    await client.query({ query: "SELECT 42", format: "JSONEachRow" });
    await client.query({
      query: "SELECT 42",
      format: "JSONEachRow",
      http_headers: { "x-clickhouse-format": "CSV" },
    });
    expect(requests).toHaveLength(2);
    for (const headers of requests) {
      expect(headers).not.toHaveProperty("x-clickhouse-format");
      expect(headers["from-instance"]).toBe("foo");
    }
    await client.close();
  });

  it("is sent by exec()", async () => {
    const { client, requests } = createClientRecordingHeaders({
      "X-ClickHouse-Format": "CSV",
    });
    await client.exec({ query: "SELECT 42" });
    expect(requests).toHaveLength(1);
    expect(requests[0]!["x-clickhouse-format"]).toBe("CSV");
    await client.close();
  });
});
