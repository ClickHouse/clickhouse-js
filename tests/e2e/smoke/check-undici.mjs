// Pre-publish smoke test of the optional undici entry point (ESM).
//
// Native ESM does not resolve a directory, and the package has no `exports`
// field, so ESM imports the entry point by its full path.
import { createClient } from "@clickhouse/client";
import { undiciTransport } from "@clickhouse/client/undici/index.js";
import assert from "node:assert";

const transport = undiciTransport();
assert.strictEqual(transport.name, "undici");
const client = createClient({ transport });
assert.ok(client, "createClient should accept the undici transport");
await client.close();

console.log(
  "OK (ESM): @clickhouse/client/undici/index.js resolved and executed",
);
