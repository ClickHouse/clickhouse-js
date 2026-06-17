import { createClient } from "@clickhouse/client";
import type { ClickHouseClient } from "@clickhouse/client";
import { Readable } from "node:stream";
import { request } from "undici";

/**
 * A tiny transport abstraction so the benchmark can drive both the real
 * Node.js client (which uses the legacy `http`/`https` modules under the hood)
 * and a trivial `undici.request()`-based stub through the exact same scenarios.
 *
 * Every method fully drains the response body (counting the bytes read) so the
 * comparison reflects end-to-end transport cost, not just time-to-first-byte.
 */
export interface TransportClient {
  readonly name: string;
  /** Execute a read query and drain its response body. Returns bytes read. */
  query(sql: string): Promise<number>;
  /** POST an insert `body` for the given `query` and drain the response. */
  insert(query: string, body: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Wraps `@clickhouse/client` as built from this repository (resolved via the
 * npm workspace symlink, not the published npm release), which sends requests
 * through the legacy `node:http` / `node:https` modules. `exec()` is used so we
 * measure the raw transport stream without any client-side row parsing overhead.
 */
export class SdkTransportClient implements TransportClient {
  readonly name = "@clickhouse/client (http/https)";
  private readonly client: ClickHouseClient;

  constructor(url: string) {
    this.client = createClient({
      url,
      compression: { request: false, response: false },
    });
  }

  async query(sql: string): Promise<number> {
    const { stream } = await this.client.exec({
      query: sql,
      // The default `decompress_response_stream` is irrelevant here since
      // compression is disabled; we just drain the raw bytes.
    });
    let bytes = 0;
    for await (const chunk of stream) {
      bytes += (chunk as Buffer).length;
    }
    return bytes;
  }

  async insert(query: string, body: string): Promise<void> {
    const { stream } = await this.client.exec({
      query,
      // `values` is sent as the request body while `query` goes in the URL.
      values: Readable.from(body),
    });
    // Drain the (empty) response so the socket is freed for keep-alive reuse.
    for await (const _chunk of stream) {
      void _chunk;
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

/**
 * A deliberately minimal `undici.request()`-based stub: no pooling
 * configuration, no retries, no settings handling. Just enough to issue the
 * same HTTP requests against ClickHouse so we can compare raw transport
 * throughput and latency.
 *
 * `undici` is the low-level HTTP/1.1 client the issue suggests evaluating.
 * Crucially we use `request()` rather than the global `fetch()`: `request()`
 * returns the response body as a Node.js `Readable` stream, whereas `fetch()`
 * exposes it through the much slower WebStreams (`ReadableStream`) layer. This
 * keeps the comparison against `@clickhouse/client` apples-to-apples — both
 * drain a native Node stream — and reflects the API a real migration would use.
 * See https://github.com/nodejs/undici/issues/1203.
 */
export class UndiciTransportClient implements TransportClient {
  readonly name = "undici request() (native stream)";
  private readonly baseUrl: string;

  constructor(url: string) {
    this.baseUrl = url.endsWith("/") ? url.slice(0, -1) : url;
  }

  async query(sql: string): Promise<number> {
    const { statusCode, body } = await request(this.baseUrl + "/", {
      method: "POST",
      body: sql,
    });
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`Unexpected status ${statusCode}: ${await body.text()}`);
    }
    let bytes = 0;
    for await (const chunk of body) {
      bytes += (chunk as Buffer).length;
    }
    return bytes;
  }

  async insert(query: string, body: string): Promise<void> {
    const url = this.baseUrl + "/?query=" + encodeURIComponent(query);
    const { statusCode, body: resBody } = await request(url, {
      method: "POST",
      body,
    });
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(
        `Unexpected status ${statusCode}: ${await resBody.text()}`,
      );
    }
    // Drain the response body to release the connection back to the pool.
    for await (const _chunk of resBody) {
      void _chunk;
    }
  }

  async close(): Promise<void> {
    // The global undici dispatcher/agent is shared; nothing to close.
  }
}
