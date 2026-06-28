import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createClient,
  ClickHouseError,
  type ClickHouseClient,
} from "@clickhouse/client-web";

// The publish workflow starts the single-node ClickHouse compose service before
// this runs. Its HTTP interface sends CORS headers (see
// .docker/clickhouse/single_node/config.xml -> <http_options_response>), so the
// browser can reach it cross-origin from the vitest page.
const url = "http://127.0.0.1:8123";

describe("[Web e2e] published @clickhouse/client-web in a real browser", () => {
  let client: ClickHouseClient;

  beforeAll(() => {
    client = createClient({ url });
  });

  afterAll(async () => {
    await client.close();
  });

  it("pings the server", async () => {
    const res = await client.ping();
    expect(res.success).toBe(true);
  });

  it("runs a simple query and reads JSON", async () => {
    const rs = await client.query({
      // toUInt8 keeps the value an unquoted JSON number regardless of the
      // server's 64-bit-integer quoting default.
      query: "SELECT toUInt8(number) AS n FROM system.numbers LIMIT 3",
      format: "JSONEachRow",
    });
    expect(await rs.json()).toEqual([{ n: 0 }, { n: 1 }, { n: 2 }]);
  });

  it("streams rows", async () => {
    const rs = await client.query({
      query: "SELECT number FROM system.numbers LIMIT 5",
      format: "JSONEachRow",
    });
    let streamed = 0;
    for await (const rows of rs.stream()) {
      streamed += rows.length;
    }
    expect(streamed).toBe(5);
  });

  it("surfaces a bad query as a ClickHouseError", async () => {
    await expect(
      client.query({
        query: "SELECT * FROM table_that_does_not_exist_e2e_web",
        format: "JSONEachRow",
      }),
    ).rejects.toBeInstanceOf(ClickHouseError);
  });
});
