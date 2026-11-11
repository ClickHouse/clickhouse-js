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

// undici must not be in the manifest, also not as an (optional) peer
// dependency: that breaks `npm install` with ERESOLVE for every application
// that depends on another undici major version. `undiciTransport()` checks
// the version at runtime instead.
const manifest = require("@clickhouse/client/package.json");
for (const field of [
  "dependencies",
  "peerDependencies",
  "peerDependenciesMeta",
  "optionalDependencies",
]) {
  assert.strictEqual(
    manifest[field]?.undici,
    undefined,
    `undici is in ${field} of @clickhouse/client`,
  );
}
const version = require("undici/package.json").version;
console.log(`undici ${version} is installed by the application`);

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
