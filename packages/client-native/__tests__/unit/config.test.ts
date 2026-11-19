import { describe, expect, it } from "vitest";
import { createClient } from "../../src";

describe("Native client configuration", () => {
  it("accepts TCP compression and a connect timeout in the URL", async () => {
    const client = createClient({
      url: "tcp://localhost:9000/?compression=lz4&connect_timeout=500",
    });
    await client.close();
  });

  it("reports unsupported URL compression", () => {
    expect(() =>
      createClient({ url: "tcp://localhost:9000/?compression=gzip" }),
    ).toThrow('"compression" URL parameter must be one of none, lz4, zstd');
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
