import { createClient } from "@clickhouse/client-web";

// Attach one or more temporary tables ("external data") to a single query over HTTP.
// Unlike `CREATE TEMPORARY TABLE`, external data needs no `session_id` and works
// behind stateless load balancers, while avoiding the 128 KiB `http_max_field_value_size`
// limit that applies to large `IN (...)` query parameters.
// Web variant: supports string, Uint8Array, and JSON* row arrays (ReadableStream inputs are Node-only).
const client = createClient();

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

await client.close();
