import { describe, it, expect, beforeEach, vi } from "vitest";
import { createClient } from "../../src";

beforeEach(() => {
  vi.clearAllMocks();
});

function stubFetch() {
  return vi.fn(async () => ({
    status: 200,
    body: null,
    headers: new Headers({ "x-clickhouse-query-id": "test-query-id" }),
  })) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
}

describe("[Web] external_data unit tests", () => {
  it("sends external_data URL params and Uint8Array multipart body on query() and command()", async () => {
    const fetchStub = stubFetch();
    const client = createClient({
      url: "https://localhost:8443",
      fetch: fetchStub,
      use_multipart_params: true,
    });

    await client.query({
      query: "SELECT _1, _2 FROM ext WHERE _2 > {min_n:UInt32}",
      format: "JSONEachRow",
      query_params: { min_n: 3 },
      external_data: [
        {
          name: "ext",
          types: ["String", "UInt32"],
          format: "JSONCompactEachRow",
          data: [
            ["alpha", 10],
            ["beta", 20],
          ],
        },
      ],
    });

    const [rawUrl, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    const parsedUrl = new URL(rawUrl);
    expect(parsedUrl.searchParams.get("ext_types")).toBe("String, UInt32");
    expect(parsedUrl.searchParams.get("ext_format")).toBe("JSONCompactEachRow");
    expect(parsedUrl.searchParams.has("param_min_n")).toBe(false);

    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toMatch(
      /^multipart\/form-data; boundary=----clickhouse-js-/,
    );
    expect(init.body).toBeInstanceOf(Uint8Array);
    const bodyText = new TextDecoder().decode(init.body as Uint8Array);
    expect(bodyText).toContain(
      'Content-Disposition: form-data; name="query"\r\n\r\nSELECT _1, _2 FROM ext WHERE _2 > {min_n:UInt32}\r\n',
    );
    expect(bodyText).toContain(
      'Content-Disposition: form-data; name="param_min_n"\r\n\r\n3\r\n',
    );
    expect(bodyText).toContain(
      'Content-Disposition: form-data; name="ext"; filename="ext"\r\nContent-Type: application/octet-stream\r\n\r\n["alpha",10]\n["beta",20]\n\r\n',
    );

    await client.command({
      query: "CREATE TEMPORARY TABLE tmp AS SELECT * FROM ext",
      external_data: [
        {
          name: "ext",
          structure: "id String",
          data: new TextEncoder().encode("one\ntwo\n"),
        },
      ],
    });
    const [cmdUrl, cmdInit] = fetchStub.mock.calls[1] as [string, RequestInit];
    expect(new URL(cmdUrl).searchParams.get("ext_structure")).toBe("id String");
    expect((cmdInit.headers as Record<string, string>)["Content-Type"]).toMatch(
      /^multipart\/form-data; boundary=/,
    );

    await client.close();
  });

  it("rejects ReadableStream in external_data at runtime if bypassed via untyped JS", async () => {
    const fetchStub = stubFetch();
    const client = createClient({
      url: "https://localhost:8443",
      fetch: fetchStub,
    });

    const stream = new ReadableStream();
    await expect(
      client.query({
        query: "SELECT * FROM ext",
        external_data: [
          {
            name: "ext",
            structure: "id String",
            data: stream as any,
          },
        ],
      }),
    ).rejects.toThrow(
      'Streaming is not supported for external_data ("ext") in the web version of the client',
    );

    await client.close();
  });
});
