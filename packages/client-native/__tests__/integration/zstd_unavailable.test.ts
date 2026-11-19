import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient as createHttpClient } from "../../../client-node/src";
import type { ClickHouseClient as HttpClient } from "../../../client-node/src";
import { createClient } from "../../src";
import { isZstdAvailable } from "../../src/compression/frames";
import { httpURL, nativeURL, uniqueName } from "./utils";

// A runtime without the zstd APIs of zlib, as Node.js before 22.15.
vi.mock("node:zlib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:zlib")>();
  const zlib = {
    ...actual.default,
    zstdCompressSync: undefined,
    zstdDecompressSync: undefined,
  };
  return { ...zlib, default: zlib };
});

describe("[Native] runtime without zstd", () => {
  let http: HttpClient;
  const username = uniqueName("clickhousejs__zstd_default");
  const password = `CHJS_${uniqueName("pw")};`;

  beforeAll(async () => {
    http = createHttpClient({ url: httpURL() });
    // A user whose server-side default compression is ZSTD, so the test does
    // not depend on the default of the server version.
    await http.command({
      query: `CREATE USER ${username} IDENTIFIED WITH sha256_password BY '${password}' SETTINGS network_compression_method = 'ZSTD'`,
    });
    await http.command({
      query: `GRANT SELECT ON system.* TO ${username}`,
    });
  });

  afterAll(async () => {
    await http.command({ query: `DROP USER IF EXISTS ${username}` });
    await http.close();
  });

  it("has no zstd", () => {
    expect(isZstdAvailable()).toBe(false);
  });

  it("reads lz4 results although the server default is ZSTD", async () => {
    const client = createClient({
      url: nativeURL(),
      username,
      password,
      compression: "lz4",
    });
    try {
      const rs = await client.query({
        query: "SELECT number FROM system.numbers LIMIT 50000",
        format: "JSONEachRow",
      });
      // UInt64 is quoted or not, depending on the server version.
      const rows = await rs.json<{ number: string | number }>();
      expect(rows.length).toBe(50000);
      expect(Number(rows[49999]?.number)).toBe(49999);
    } finally {
      await client.close();
    }
  });

  it("refuses zstd compression with a clear error", () => {
    expect(() =>
      createClient({ url: nativeURL(), compression: "zstd" }),
    ).toThrow(/zstd compression is not supported by this Node\.js runtime/);
  });
});
