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

// The installed undici must match the peer dependency range (`^<major>`).
const range = require("@clickhouse/client/package.json").peerDependencies
  .undici;
const version = require("undici/package.json").version;
assert.ok(
  range.startsWith("^") &&
    version.split(".")[0] === range.slice(1).split(".")[0],
  `undici ${version} does not match the peer dependency range ${range}`,
);
console.log(`undici ${version} matches the peer dependency range ${range}`);

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
