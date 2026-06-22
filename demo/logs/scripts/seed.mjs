#!/usr/bin/env node
/**
 * Seed the demo logs table.
 *
 * Standalone Node script (no build step, no client dependency): talks to the
 * ClickHouse HTTP interface with `fetch`, creates `demo_logs`, and fabricates a
 * batch of realistic-looking rows with `INSERT ... SELECT FROM numbers(N)` so all
 * the generation happens server-side.
 *
 *   node scripts/seed.mjs           # 1000 rows
 *   node scripts/seed.mjs 50000     # custom row count
 *
 * Connection comes from the same env vars the app uses (CLICKHOUSE_URL etc.),
 * defaulting to this repo's docker-compose ClickHouse on localhost:8123.
 */

const CONFIG = {
  url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
  user: process.env.CLICKHOUSE_USER ?? "default",
  password: process.env.CLICKHOUSE_PASSWORD ?? "",
  database: process.env.CLICKHOUSE_DATABASE ?? "default",
};

const TABLE = "demo_logs";
const ROWS = Number(process.argv[2] ?? 1000);

function endpoint() {
  const u = new URL(CONFIG.url);
  u.searchParams.set("database", CONFIG.database);
  return u.toString();
}

async function exec(sql) {
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: {
      "X-ClickHouse-User": CONFIG.user,
      "X-ClickHouse-Key": CONFIG.password,
    },
    body: sql,
  });
  if (!res.ok) {
    throw new Error(`ClickHouse failed (${res.status}): ${await res.text()}`);
  }
  return res.text();
}

const CREATE = `
CREATE TABLE IF NOT EXISTS ${TABLE} (
  timestamp   DateTime64(3),
  level       Enum8('debug' = 1, 'info' = 2, 'warn' = 3, 'error' = 4),
  service     LowCardinality(String),
  host        IPv4,
  trace_id    UUID,
  status      UInt16,
  duration_ms Float64,
  message     String
)
ENGINE = MergeTree
ORDER BY timestamp`;

// Everything is generated server-side from `number`. `now64(3) - number seconds`
// spreads rows back in time so newest-first paging has something to walk.
const INSERT = `
INSERT INTO ${TABLE}
SELECT
  now64(3) - toIntervalSecond(number)                                                    AS timestamp,
  ['info','info','info','debug','debug','warn','warn','error','info','debug'][(number % 10) + 1] AS level,
  ['api-gateway','auth','payments','catalog','search','notifications'][(number % 6) + 1] AS service,
  toIPv4(concat('10.0.', toString(number % 256), '.', toString((number * 37) % 256)))    AS host,
  generateUUIDv4()                                                                        AS trace_id,
  [200,200,200,201,204,301,400,404,500,503][(number % 10) + 1]                            AS status,
  round(rand(number) / 4294967.295, 3)                                                    AS duration_ms,
  ['request completed','request failed upstream','cache miss','cache hit','user login','user logout','slow db query','rate limit exceeded','payment authorized','token refreshed'][(number % 10) + 1] AS message
FROM numbers(${ROWS})`;

async function main() {
  if (!Number.isFinite(ROWS) || ROWS <= 0) {
    throw new Error(`Invalid row count: ${process.argv[2]}`);
  }
  console.log(`Seeding ${ROWS} rows into ${CONFIG.database}.${TABLE} …`);
  await exec(CREATE);
  await exec(`TRUNCATE TABLE ${TABLE}`);
  await exec(INSERT);
  const count = (await exec(`SELECT count() FROM ${TABLE}`)).trim();
  console.log(`Done. ${TABLE} now has ${count} rows.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
