import { describe, it, expect, beforeEach, vi } from "vitest";
import Http from "http";
import Stream from "stream";
import { createClient } from "../../src";
import {
  buildHttpConnection,
  emitResponseBody,
  stubClientRequest,
} from "../utils/http_stubs";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("[Node.js] external_data unit tests", () => {
  it("sends structure/format in URL and SQL + file part in multipart body on query()", async () => {
    const chunks: Buffer[] = [];
    const request = stubClientRequest();
    const origWrite = request._write.bind(request);
    request._write = (chunk, encoding, callback) => {
      chunks.push(
        Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(
              chunk,
              typeof encoding === "string" && encoding !== "buffer"
                ? (encoding as BufferEncoding)
                : "utf8",
            ),
      );
      origWrite(chunk, encoding, callback);
    };

    const httpSpy = vi.spyOn(Http, "request").mockReturnValue(request);
    const client = createClient({
      url: "http://localhost:8123",
      keep_alive: { enabled: false },
    });

    const queryPromise = client.query({
      query: "SELECT id, n FROM ext WHERE n > {min_n:UInt32}",
      format: "JSONEachRow",
      query_params: { min_n: 5 },
      external_data: [
        {
          name: "ext",
          structure: "id String, n UInt32",
          format: "TSV",
          data: "a\t10\nb\t20\n",
        },
      ],
    });

    // Trigger socket so SocketPool.pipeStream() runs and writes the body
    setTimeout(() => {
      request.emit("socket", request.socket);
    }, 5);
    await emitResponseBody(request, '{"id":"a","n":10}\n');
    const rs = await queryPromise;
    expect(await rs.json()).toEqual([{ id: "a", n: 10 }]);

    // Wait one tick for pipeline to flush
    await new Promise((r) => setTimeout(r, 10));

    const [url, options] = httpSpy.mock.calls[0] as [URL, Http.RequestOptions];
    expect(url.searchParams.get("ext_structure")).toBe("id String, n UInt32");
    expect(url.searchParams.get("ext_format")).toBe("TSV");
    expect(url.searchParams.get("param_min_n")).toBe("5");
    expect(url.searchParams.has("query")).toBe(false);

    const contentType = (options.headers as Record<string, string>)[
      "Content-Type"
    ];
    expect(contentType).toMatch(
      /^multipart\/form-data; boundary=----clickhouse-js-/,
    );

    const bodyText = Buffer.concat(chunks).toString("utf8");
    expect(bodyText).toContain(
      'Content-Disposition: form-data; name="query"\r\n\r\nSELECT id, n FROM ext WHERE n > {min_n:UInt32}\r\n',
    );
    expect(bodyText).toContain(
      'Content-Disposition: form-data; name="ext"; filename="ext"\r\nContent-Type: application/octet-stream\r\n\r\na\t10\nb\t20\n\r\n',
    );
    await client.close();
  });

  it("streams object-mode JSON streams into multipart body and disables request compression on command()", async () => {
    const chunks: Buffer[] = [];
    const request = stubClientRequest();
    request._write = (chunk, encoding, callback) => {
      chunks.push(
        Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(
              chunk,
              typeof encoding === "string" && encoding !== "buffer"
                ? (encoding as BufferEncoding)
                : "utf8",
            ),
      );
      callback();
    };

    const httpSpy = vi.spyOn(Http, "request").mockReturnValue(request);
    const client = createClient({
      url: "http://localhost:8123",
      compression: { request: true },
      use_multipart_params: true,
      keep_alive: { enabled: false },
    });

    const objStream = Stream.Readable.from(
      [
        { id: "x", n: 1 },
        { id: "y", n: 2 },
      ],
      { objectMode: true },
    );

    const cmdPromise = client.command({
      query:
        "CREATE TEMPORARY TABLE tmp AS SELECT * FROM ext WHERE n >= {p:UInt32}",
      query_params: { p: 1 },
      external_data: [
        {
          name: "ext",
          structure: "id String, n UInt32",
          format: "JSONEachRow",
          data: objStream,
        },
      ],
    });

    setTimeout(() => {
      request.emit("socket", request.socket);
    }, 5);
    await emitResponseBody(request, "");
    await cmdPromise;
    await new Promise((r) => setTimeout(r, 15));

    const [url, options] = httpSpy.mock.calls[0] as [URL, Http.RequestOptions];
    const headers = options.headers as Record<string, string>;
    expect(headers["Content-Encoding"]).toBeUndefined();
    expect(headers["Content-Type"]).toMatch(/^multipart\/form-data; boundary=/);
    expect(url.searchParams.has("param_p")).toBe(false);
    expect(url.searchParams.get("ext_format")).toBe("JSONEachRow");

    const bodyText = Buffer.concat(chunks).toString("utf8");
    expect(bodyText).toContain('name="param_p"\r\n\r\n1\r\n');
    expect(bodyText).toContain('{"id":"x","n":1}\n{"id":"y","n":2}\n\r\n');
    await client.close();
  });

  it("handles connection-level external_data with use_multipart_params_auto", async () => {
    const adapter = buildHttpConnection({
      use_multipart_params_auto: true,
    });
    const request = stubClientRequest();
    const httpSpy = vi.spyOn(Http, "request").mockReturnValue(request);

    const p = adapter.query({
      query: "SELECT * FROM ext WHERE s = {big:String}",
      query_params: { big: "x".repeat(5000) },
      external_data: [
        {
          name: "ext",
          types: "String",
          data: "a\n",
        },
      ],
    });
    await emitResponseBody(request, "ok");
    await p;

    const [url, options] = httpSpy.mock.calls[0];
    expect(url.search).toContain("ext_types=String");
    expect(url.search).not.toContain("param_big");
    expect(options.headers["Content-Type"]).toMatch(
      /^multipart\/form-data; boundary=/,
    );
  });

  it("rejects object-mode streams for non-JSON formats and conflicting exec values + external_data", async () => {
    const client = createClient({
      url: "http://localhost:8123",
      keep_alive: { enabled: false },
    });

    await expect(
      client.query({
        query: "SELECT * FROM ext",
        external_data: [
          {
            name: "ext",
            structure: "id String",
            format: "TSV",
            data: Stream.Readable.from([{ id: "a" }], { objectMode: true }),
          },
        ],
      }),
    ).rejects.toThrow(
      /object-mode streams are only supported for JSON\* formats/,
    );

    await expect(
      client.exec({
        query: "INSERT INTO t FORMAT TSV",
        values: Stream.Readable.from(["a\n"]),
        external_data: [
          {
            name: "ext",
            structure: "id String",
            data: "a\n",
          },
        ],
      } as any),
    ).rejects.toThrow(
      'Cannot use both "values" and "external_data" in exec() at the same time.',
    );

    await client.close();
  });
});
