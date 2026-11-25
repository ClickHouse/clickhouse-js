import "server-only";

/**
 * Tiny ClickHouse HTTP access layer for the demo — no client dependency, just
 * `fetch` against the HTTP interface. We deliberately keep this minimal so the
 * interesting part stays the RowBinary decode in `lib/logs.ts`.
 *
 * Connection comes from the environment, defaulting to the single-node
 * `docker-compose` ClickHouse this repo ships (HTTP on 8123, default user, no
 * password). Override with CLICKHOUSE_URL / CLICKHOUSE_USER / CLICKHOUSE_PASSWORD
 * / CLICKHOUSE_DATABASE.
 */
const CONFIG = {
  url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
  user: process.env.CLICKHOUSE_USER ?? "default",
  password: process.env.CLICKHOUSE_PASSWORD ?? "",
  database: process.env.CLICKHOUSE_DATABASE ?? "default",
};

function endpoint(): string {
  const u = new URL(CONFIG.url);
  u.searchParams.set("database", CONFIG.database);
  return u.toString();
}

function authHeaders(): Record<string, string> {
  return {
    "X-ClickHouse-User": CONFIG.user,
    "X-ClickHouse-Key": CONFIG.password,
  };
}

/**
 * Run a query whose result should be decoded as raw `RowBinary` and return the
 * complete response as a single `Buffer`. We page with `LIMIT`/`OFFSET`, so each
 * response is small — buffering the whole thing and decoding it in one shot is
 * both simpler and faster than streaming here (no `advance()` bounds check ever
 * needs to fire). `FORMAT RowBinary` is appended by the caller's SQL.
 */
export async function queryRowBinary(sql: string): Promise<Buffer> {
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: authHeaders(),
    body: sql,
  });
  if (!res.ok) {
    throw new Error(
      `ClickHouse query failed (${res.status}): ${await res.text()}`,
    );
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
