// True end-to-end A/B: the experimental Rust-decode methods vs the JSON paths,
// ALL through the real @clickhouse/client transport stack (socket pool, query
// params, error handling). Compares only within the same output-shape tier:
//
//   columns        queryNativeColumns (TypedArrays)        vs JSONCompactEachRow .json() + transpose
//   rows (arrays)  queryNativeRows({row_shape:'arrays'})   vs JSONCompactEachRow .json()
//   rows (objects) queryNativeRows() (objects)             vs JSONEachRow .json()
//
// Both legs run uncompressed: exec() and query() promote compression settings
// to HTTP headers differently, but compression defaults to OFF for both, so
// the transport is symmetric as long as it stays at the default.
//
// REQUIRES node --expose-gc: gc() runs before every timed sample so no path
// pays another path's garbage-collection debt inside its timing window
// (measured 10x inflation on the Native decode without this).

import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createClient } = require('../packages/client-node/dist/index.js')

if (typeof globalThis.gc !== 'function') {
  console.error('FATAL: run with node --expose-gc (per-sample GC isolation is required for trustworthy numbers)')
  process.exit(1)
}
const gc = globalThis.gc

const N = Number(process.env.ROWS ?? 100000)
const RUNS = Number(process.env.RUNS ?? 7)
const QUERY = `SELECT id, val, name, flag, small_int, big_uint FROM bench_types ORDER BY id LIMIT ${N}`

const EXPECTED_SCHEMA = [
  ['id', 'Int64'],
  ['val', 'Float64'],
  ['name', 'String'],
  ['flag', 'Bool'],
  ['small_int', 'Int32'],
  ['big_uint', 'UInt64'],
]
const DDL = `CREATE TABLE IF NOT EXISTS bench_types (
  id Int64, val Float64, name String, flag Bool, small_int Int32, big_uint UInt64
) ENGINE MergeTree ORDER BY id`

const client = createClient({ url: 'http://localhost:8123' })

// ── table setup: create if missing, assert schema, top up deterministically ──

await client.command({ query: DDL })

const schema = await (
  await client.query({
    query: `SELECT name, type FROM system.columns WHERE database = currentDatabase() AND table = 'bench_types' ORDER BY position`,
    format: 'JSONCompactEachRow',
  })
).json()
if (JSON.stringify(schema) !== JSON.stringify(EXPECTED_SCHEMA)) {
  console.error('FATAL: existing bench_types table does not match the expected schema (CREATE IF NOT EXISTS would silently reuse it).')
  console.error('  found:   ', JSON.stringify(schema))
  console.error('  expected:', JSON.stringify(EXPECTED_SCHEMA))
  console.error('  drop it or rename it, then re-run.')
  process.exit(1)
}

const [[countStr]] = await (
  await client.query({ query: 'SELECT count() FROM bench_types', format: 'JSONCompactEachRow' })
).json()
const existing = Number(countStr)
if (existing < N) {
  console.log(`bench_types has ${existing.toLocaleString()} rows; topping up to ${N.toLocaleString()}...`)
  await client.command({
    query: `INSERT INTO bench_types
            SELECT toInt64(number) AS id,
                   sin(number / 1000) * 1000 AS val,
                   concat('row_', toString(number), '_', repeat('x', toUInt8(number % 32))) AS name,
                   number % 3 = 0 AS flag,
                   toInt32(number % 100000 - 50000) AS small_int,
                   toUInt64(number) * 2654435761 AS big_uint
            FROM numbers(${existing}, ${N - existing})`,
    clickhouse_settings: { max_insert_block_size: '1000000' },
  })
}

// ── timing helpers (ported from bench_fair.mjs) ─────────────────────────────

const fmt = (ms) => `${ms.toFixed(1)} ms`.padStart(11)
const rate = (ms) => `${Math.round(N / (ms / 1000)).toLocaleString()} rows/s`.padStart(18)
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return { min: s[0], median: s[(s.length / 2) | 0] }
}

async function timeAsync(fn, runs) {
  await fn() // warmup
  const samples = []
  for (let i = 0; i < runs; i++) {
    gc()
    const t = performance.now()
    await fn()
    samples.push(performance.now() - t)
  }
  return stats(samples)
}

function line(label, s, baseline) {
  const x = baseline ? `  ${(s.median / baseline).toFixed(2)}x` : '  1.00x (baseline)'
  console.log(`  ${label.padEnd(42)} ${fmt(s.median)} ${rate(s.median)}${x}`)
}

function transpose(rows, numCols) {
  const cols = Array.from({ length: numCols }, () => new Array(rows.length))
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    for (let j = 0; j < numCols; j++) cols[j][i] = row[j]
  }
  return cols
}

// ── sanity: both sides agree on the data before timing anything ────────────

{
  const nat = await client.queryNativeRows({ query: QUERY, row_shape: 'arrays' })
  const json = await (await client.query({ query: QUERY, format: 'JSONCompactEachRow' })).json()
  if (nat.rows.length !== json.length || nat.rows.length !== N) {
    throw new Error(`row count mismatch: native=${nat.rows.length} json=${json.length} expected=${N}`)
  }
  for (const i of [0, (N / 2) | 0, N - 1]) {
    const a = nat.rows[i]
    const b = json[i]
    if (
      String(a[0]) !== String(b[0]) || a[1] !== b[1] || a[2] !== b[2] ||
      a[3] !== Boolean(b[3]) || a[4] !== b[4] || String(a[5]) !== String(b[5])
    ) {
      throw new Error(`row ${i} mismatch:\n  native ${JSON.stringify(a, (_, v) => (typeof v === 'bigint' ? String(v) : v))}\n  json   ${JSON.stringify(b)}`)
    }
  }
}

// ── run ─────────────────────────────────────────────────────────────────────

console.log(`\nbench_types: ${N.toLocaleString()} rows x 6 cols | runs: ${RUNS} | medians | ALL paths via @clickhouse/client`)

console.log('\n── E2E: -> columns ──')
const eNativeCols = await timeAsync(() => client.queryNativeColumns({ query: QUERY }), RUNS)
const eJsonCols = await timeAsync(
  async () => transpose(await (await client.query({ query: QUERY, format: 'JSONCompactEachRow' })).json(), 6),
  RUNS,
)
line('queryNativeColumns (TypedArrays)', eNativeCols)
line('query JSONCompactEachRow .json()+transpose', eJsonCols, eNativeCols.median)

console.log('\n── E2E: -> rows (positional arrays) ──')
const eNativeRows = await timeAsync(() => client.queryNativeRows({ query: QUERY, row_shape: 'arrays' }), RUNS)
const eJsonRows = await timeAsync(
  async () => (await client.query({ query: QUERY, format: 'JSONCompactEachRow' })).json(),
  RUNS,
)
line('queryNativeRows (arrays)', eNativeRows)
line('query JSONCompactEachRow .json()', eJsonRows, eNativeRows.median)

console.log('\n── E2E: -> rows (objects keyed by column name) ──')
const eNativeObjs = await timeAsync(() => client.queryNativeRows({ query: QUERY }), RUNS)
const eJsonObjs = await timeAsync(
  async () => (await client.query({ query: QUERY, format: 'JSONEachRow' })).json(),
  RUNS,
)
line('queryNativeRows (objects)', eNativeObjs)
line('query JSONEachRow .json()', eJsonObjs, eNativeObjs.median)

console.log('\nNotes:')
console.log('  - Identical client/transport on both legs; compression off (default) on both.')
console.log('  - Native rows are fully materialized (utf8 -> JS strings, bitmap -> booleans).')
console.log('  - 64-bit ints: Native yields BigInt; JSON formats quote them as strings (CH default).')
console.log('  - localhost: network ~free, so the 1.5-2.7x smaller Native wire size under-counts.')

await client.close()
