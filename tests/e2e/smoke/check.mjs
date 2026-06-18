// Pre-publish smoke test (ESM).
//
// Imports symbols that originate in the (now bundled) `common` sources and are
// re-exported from `@clickhouse/client` via `./common/index`. Exercising them
// from a tarball install proves the bundled common code is compiled into the
// published artifact and usable by consumers - without `@clickhouse/client-common`
// as a runtime dependency.
import { parseColumnType, SettingsMap, ClickHouseError } from '@clickhouse/client'
import assert from 'node:assert'

const t = parseColumnType('Nullable(UInt64)')
console.log('parseColumnType("Nullable(UInt64)") =>', JSON.stringify(t))
assert.equal(t.type, 'Nullable')
assert.equal(t.value.columnType, 'UInt64')

const sm = SettingsMap.from({ max_block_size: '1000' })
console.log('SettingsMap.toString() =>', sm.toString())
assert.equal(typeof sm.toString(), 'string')

assert.equal(typeof ClickHouseError, 'function')

console.log('OK (ESM): all common-origin imports resolved and executed from the installed package')
