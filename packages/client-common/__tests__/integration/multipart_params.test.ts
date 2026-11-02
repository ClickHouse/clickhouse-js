import { describe, it, expect, afterEach } from "vitest";
import { type ClickHouseClient } from "@clickhouse/client-common";
import { createTestClient } from "../utils";

describe("multipart query params", () => {
  let client: ClickHouseClient;
  afterEach(async () => {
    await client.close();
  });

  const ids = [...Array(3000).keys()];
  const query =
    "SELECT count() FROM numbers(5000) WHERE number IN {ids:Array(UInt64)}";

  it("executes a query with large params when use_multipart_params is enabled", async () => {
    client = createTestClient({ use_multipart_params: true });
    const rs = await client.query({
      query,
      format: "CSV",
      query_params: { ids },
    });
    expect(await rs.text()).toBe("3000\n");
  });

  it("executes a query with large params when use_multipart_params_auto is enabled", async () => {
    client = createTestClient({ use_multipart_params_auto: true });
    const rs = await client.query({
      query,
      format: "CSV",
      query_params: { ids },
    });
    expect(await rs.text()).toBe("3000\n");
  });

  it("keeps small params working when use_multipart_params_auto is enabled", async () => {
    client = createTestClient({ use_multipart_params_auto: true });
    const rs = await client.query({
      query,
      format: "CSV",
      query_params: { ids: [1, 2, 3] },
    });
    expect(await rs.text()).toBe("3\n");
  });

  it("supports a per-request use_multipart_params_auto override", async () => {
    client = createTestClient();
    const rs = await client.query({
      query,
      format: "CSV",
      query_params: { ids },
      use_multipart_params_auto: true,
    });
    expect(await rs.text()).toBe("3000\n");
  });

  describe("when a value exceeds the server's form field limit", () => {
    // ClickHouse caps each multipart form field at http_max_field_value_size
    // (128 KiB by default), so anything larger cannot be sent in the form.
    const padding = "x".repeat(200_000);

    it("sends an oversized SQL statement as the raw body", async () => {
      client = createTestClient({ use_multipart_params: true });
      const rs = await client.query({
        query: `SELECT {p:UInt8} AS p, length('${padding}') AS len`,
        format: "CSV",
        query_params: { p: 1 },
      });
      expect(await rs.text()).toBe("1,200000\n");
    });

    it("keeps an oversized parameter in the URL in auto mode", async () => {
      client = createTestClient({ use_multipart_params_auto: true });
      const rs = await client.query({
        query: "SELECT length({p:String}) AS len",
        format: "CSV",
        query_params: { p: padding },
      });
      expect(await rs.text()).toBe("200000\n");
    });
  });
});
