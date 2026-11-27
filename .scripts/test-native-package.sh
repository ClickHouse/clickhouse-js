#!/usr/bin/env bash
set -euo pipefail

consumer_dir=$(mktemp -d)
trap 'rm -rf -- "$consumer_dir"' EXIT

archive=$(npm pack --workspace @clickhouse/client-native --pack-destination "$consumer_dir" --silent)
cd "$consumer_dir"
npm install --offline --no-audit --no-fund --ignore-scripts "./$archive"

node --input-type=module <<'JS'
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createClient, TupleParam } from "@clickhouse/client-native";

const require = createRequire(import.meta.url);
assert.equal(require("@clickhouse/client-native").createClient, createClient);

const client = createClient({ url: process.env.CLICKHOUSE_NATIVE_URL });
try {
  const result = await client.query({
    query: "SELECT tupleElement({value:Tuple(UInt8, String)}, 1) AS n",
    query_params: { value: new TupleParam([42, "packaged client"]) },
    format: "JSONEachRow",
  });
  assert.deepEqual(await result.json(), [{ n: 42 }]);
} finally {
  await client.close();
}
JS
