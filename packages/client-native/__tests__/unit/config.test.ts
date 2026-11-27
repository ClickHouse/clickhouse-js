import { describe, expect, it } from "vitest";
import { createClient } from "../../src";
import { isZstdAvailable } from "../../src/compression/frames";

describe("Native client configuration", () => {
  it("accepts TCP compression and a connect timeout in the URL", async () => {
    const client = createClient({
      url: "tcp://localhost:9000/?compression=lz4&connect_timeout=500",
    });
    await client.close();
  });

  it("accepts object compression options including zstd level", async () => {
    const lz4Client = createClient({ compression: { codec: "lz4" } });
    await lz4Client.close();

    if (isZstdAvailable()) {
      const zstdClient = createClient({
        compression: { codec: "zstd", level: 3 },
      });
      await zstdClient.close();
    }

    expect(() =>
      createClient({ compression: { codec: "zstd", level: 1.5 } }),
    ).toThrow("zstd compression level must be an integer");
  });

  it("reports unsupported URL compression", () => {
    expect(() =>
      createClient({ url: "tcp://localhost:9000/?compression=gzip" }),
    ).toThrow('"compression" URL parameter must be one of none, lz4, zstd');
  });

  it("rejects HTTP compression URL parameters and object form clearly", () => {
    expect(() =>
      createClient({ url: "tcp://localhost:9000/?compression_request=1" }),
    ).toThrow("HTTP compression options");
    expect(() =>
      createClient({ url: "tcp://localhost:9000/?compression_response=1" }),
    ).toThrow("HTTP compression options");
    expect(() =>
      createClient({
        url: "tcp://localhost:9000/?compression_request=1&compression=lz4",
      }),
    ).toThrow("HTTP compression options");
    expect(() =>
      // @ts-expect-error Exercise HTTP-style compression option at runtime.
      createClient({ compression: { request: true } }),
    ).toThrow("HTTP compression options");
  });

  it("rejects unsupported client-level session_id and role eagerly", () => {
    expect(() => createClient({ session_id: "s1" })).toThrow(
      "session_id is not supported",
    );
    expect(() =>
      createClient({ url: "tcp://localhost:9000/?session_id=s1" }),
    ).toThrow("session_id is not supported");
    expect(() => createClient({ role: "admin" })).toThrow(
      "role is not supported",
    );
  });

  it("rejects a negative connect timeout", () => {
    expect(() =>
      createClient({ url: "tcp://localhost:9000/?connect_timeout=-1" }),
    ).toThrow(/connect_timeout/);
  });

  it("reports unsupported compression from JavaScript callers", () => {
    expect(() =>
      // @ts-expect-error Exercise runtime input from JavaScript.
      createClient({ compression: "gzip" }),
    ).toThrow("supports the compression methods none, lz4 and zstd");
  });
});
