import { createClient } from "@clickhouse/client";
import * as Stream from "node:stream";

// Attach one or more temporary tables ("external data") to a single query over HTTP.
// Unlike `CREATE TEMPORARY TABLE`, external data needs no `session_id` and works
// behind stateless load balancers, while avoiding the 128 KiB `http_max_field_value_size`
// limit that applies to large `IN (...)` query parameters.
const client = createClient({
  url: process.env["CLICKHOUSE_URL"],
  password: process.env["CLICKHOUSE_PASSWORD"],
});

// 1. Join a temporary table of rows against a server table/view in one request
const rs = await client.query({
  query: `
    SELECT n.number AS id, s.tier AS tier
    FROM numbers(100) AS n
    INNER JOIN selected_ids AS s ON n.number = s.id
    ORDER BY id ASC
  `,
  format: "JSONEachRow",
  external_data: [
    {
      name: "selected_ids",
      structure: "id UInt64, tier String",
      format: "JSONEachRow",
      data: [
        { id: 7, tier: "gold" },
        { id: 42, tier: "silver" },
      ],
    },
  ],
});
console.info("Joined rows:", await rs.json());

// 2. Stream external data on Node.js (or pass raw TSV/CSV/Parquet strings, Buffers, or ReadStreams)
const streamRs = await client.query({
  query:
    "SELECT count() AS total, sum(weight) AS weight_sum FROM streamed_items",
  format: "JSONEachRow",
  external_data: [
    {
      name: "streamed_items",
      structure: "id String, weight UInt32",
      format: "JSONEachRow",
      data: Stream.Readable.from(
        [
          { id: "a", weight: 10 },
          { id: "b", weight: 25 },
        ],
        { objectMode: true },
      ),
    },
  ],
});
console.info("Streamed external data summary:", await streamRs.json());

await client.close();
