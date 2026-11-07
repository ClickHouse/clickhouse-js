import type { ClickHouseClient } from "@clickhouse/client-common";

const dateTime64FromJSONNumberCache: WeakMap<ClickHouseClient, boolean> =
  new WeakMap();

/**
 * Some ClickHouse versions (seen on 26.10) clamp an epoch-milliseconds JSON
 * number inserted into a `DateTime64(3)` column to `9999-12-31 23:59:59.000`
 * instead of reading it as ticks. The same value sent as a JSON string is
 * still parsed correctly. Probes the server once per client.
 */
export async function isDateTime64FromJSONNumberBroken(
  client: ClickHouseClient,
): Promise<boolean> {
  const cached = dateTime64FromJSONNumberCache.get(client);
  if (cached !== undefined) {
    return cached;
  }

  const rows = await client
    .query({
      query: `SELECT toString(d) AS d FROM format(JSONEachRow, 'd DateTime64(3, \\'UTC\\')', '{"d":1662328969123}')`,
      format: "JSONEachRow",
    })
    .then((r) => r.json<{ d: string }>());
  const broken = rows[0]?.d !== "2022-09-04 22:02:49.123";
  dateTime64FromJSONNumberCache.set(client, broken);
  return broken;
}
