// Pre-publish smoke test (CommonJS).
//
// Same intent as check.mjs, but resolves the package via `require()` to cover
// the CJS entry point of the published artifact.
const assert = require("node:assert");
const {
  parseColumnType,
  SettingsMap,
  ClickHouseError,
} = require("@clickhouse/client");

const t = parseColumnType("Array(String)");
console.log('parseColumnType("Array(String)") =>', JSON.stringify(t));
assert.strictEqual(t.type, "Array");
assert.strictEqual(t.value.columnType, "String");

const sm = SettingsMap.from({ max_block_size: "1000" });
console.log("SettingsMap.toString() =>", sm.toString());
assert.strictEqual(typeof sm.toString(), "string");

assert.strictEqual(typeof ClickHouseError, "function");

console.log(
  "OK (CJS): all common-origin imports resolved and executed from the installed package",
);
