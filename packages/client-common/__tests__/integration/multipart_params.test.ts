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
});
