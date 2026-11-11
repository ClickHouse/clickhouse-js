// Pre-publish smoke test of the optional undici entry point (CommonJS).
const assert = require("node:assert");

// The main entry point must not load undici (it is an optional peer dependency).
const { createClient } = require("@clickhouse/client");
const loaded = (name) =>
  Object.keys(require.cache).some((k) => k.includes(`/node_modules/${name}/`));
assert.strictEqual(
  loaded("undici"),
  false,
  "the main entry point loaded undici",
);

for (const specifier of [
  "@clickhouse/client/undici",
  "@clickhouse/client/undici/index.js",
]) {
  const { undiciTransport } = require(specifier);
  assert.strictEqual(undiciTransport().name, "undici", specifier);
}
const { undiciTransport } = require("@clickhouse/client/undici");
const client = createClient({ transport: undiciTransport() });
assert.ok(client, "createClient should accept the undici transport");
client.close();

console.log("OK (CJS): @clickhouse/client/undici resolved and executed");
