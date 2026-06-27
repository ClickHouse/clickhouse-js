// Post-publish integration smoke against a real ClickHouse server.
//
// Where src/index.ts proves the freshly published @clickhouse/client installs
// and exposes the expected version + createClient, this exercises the installed
// artifact END-TO-END against a live server: connect, create/insert/select,
// stream, and confirm a bad query surfaces as a ClickHouseError. It runs in the
// publish workflow's e2e job (which installs the package by its published
// version and starts a single-node ClickHouse), so it validates the actual npm
// tarball a consumer would receive, not the local build.
const assert = require("assert");
const { createClient, ClickHouseError } = require("@clickhouse/client");

// The e2e job starts ClickHouse via docker-compose just before this runs; poll
// ping briefly so we don't race the container coming up.
async function waitForClickHouse(client: any) {
  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await client.ping();
      if (res.success) return;
    } catch {
      // not ready yet
    }
    if (attempt === maxAttempts) {
      throw new Error("ClickHouse did not become available in time");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function main() {
  // Defaults target http://localhost:8123 with the default user, matching the
  // single-node `clickhouse` service from docker-compose.yml.
  const client = createClient();
  try {
    await waitForClickHouse(client);

    const table = `e2e_install_${Date.now()}`;
    await client.command({
      query: `CREATE TABLE ${table} (id UInt32, name String) ENGINE = MergeTree ORDER BY id`,
    });

    await client.insert({
      table,
      values: [
        { id: 1, name: "foo" },
        { id: 2, name: "bar" },
      ],
      format: "JSONEachRow",
    });

    const rs = await client.query({
      query: `SELECT id, name FROM ${table} ORDER BY id`,
      format: "JSONEachRow",
    });
    assert.deepStrictEqual(await rs.json(), [
      { id: 1, name: "foo" },
      { id: 2, name: "bar" },
    ]);

    // Streamed read.
    const streamRs = await client.query({
      query: "SELECT number FROM system.numbers LIMIT 3",
      format: "JSONEachRow",
    });
    let streamed = 0;
    for await (const rows of streamRs.stream()) {
      streamed += rows.length;
    }
    assert.strictEqual(streamed, 3, "should stream 3 rows");

    // A bad query must surface as a ClickHouseError instance from the SAME
    // installed package (a single bundle => one class identity).
    let caught: unknown;
    try {
      await client.query({
        query: "SELECT * FROM table_that_does_not_exist_e2e",
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

    await client.command({ query: `DROP TABLE ${table}` });
    console.log(
      "OK: integration against the published @clickhouse/client passed",
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
