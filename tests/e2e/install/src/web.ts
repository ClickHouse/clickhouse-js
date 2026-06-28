// Light post-publish e2e for the freshly published @clickhouse/client-web.
//
// The Web client is fetch-based and runs on Node too, so we exercise the
// installed npm tarball END-TO-END against a live single-node ClickHouse:
// import the package, create a client, ping, run a simple query, and confirm a
// bad query surfaces as a ClickHouseError. It is intentionally lighter than the
// Node client's integration.ts (no table create/insert) — just enough to prove
// the published Web tarball imports and talks to a server.
//
// Unlike the Node client e2e, we do not assert the exact installed version
// here: the Web package's "exports" map encapsulates dist/, so its
// dist/version is not importable, and the workflow already installs the exact
// published version (`@clickhouse/client-web@<published>`).
//
// NOTE: this file is run via `node src/web.ts` across Node 20/22/24/26. Node 20
// does not strip TypeScript types, so this must stay free of TS-only syntax (no
// type annotations, `as` casts, etc.) — plain JS in a .ts file, like
// src/index.ts and src/integration.ts.
const assert = require("assert");
const { createClient, ClickHouseError } = require("@clickhouse/client-web");

async function main() {
  assert.strictEqual(
    typeof createClient,
    "function",
    "createClient should be a function",
  );

  // Defaults target http://localhost:8123 with the default user, matching the
  // single-node `clickhouse` service from docker-compose.yml.
  const client = createClient();
  try {
    // The e2e job starts ClickHouse via docker-compose just before this runs;
    // poll ping briefly so we don't race the container coming up.
    const maxAttempts = 30;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await client.ping();
        if (res.success) break;
      } catch {
        // not ready yet
      }
      if (attempt === maxAttempts) {
        throw new Error("ClickHouse did not become available in time");
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const rs = await client.query({
      query: "SELECT number FROM system.numbers LIMIT 3",
      format: "JSONEachRow",
    });
    assert.deepStrictEqual(await rs.json(), [
      { number: 0 },
      { number: 1 },
      { number: 2 },
    ]);

    // A bad query must surface as a ClickHouseError instance from the SAME
    // installed package (a single bundle => one class identity).
    let caught;
    try {
      await client.query({
        query: "SELECT * FROM table_that_does_not_exist_e2e_web",
        format: "JSONEachRow",
      });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "expected an error for a bad query");
    assert.ok(
      caught instanceof ClickHouseError,
      "a server error should be a ClickHouseError instance",
    );

    console.log(
      "OK: light e2e against the published @clickhouse/client-web passed",
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
