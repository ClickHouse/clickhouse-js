// Apples-to-apples benchmark: Rust Native decode vs JS JSON parse, with both
// axes that bench.mjs leaves uneven pinned equal:
//
//   1. Transport — every end-to-end path fetches over the SAME raw
//      http.request keep-alive agent. The real @clickhouse/client appears only
//      in a clearly-labeled reference section (that's what users get today,
//      but it bundles different transport/overhead, so it isn't the A/B).
//   2. Output shape — paths are compared only within the same materialization
//      tier, because "decoded" means different amounts of work per format:
//        columns        Native TypedArray columns  vs  JSON parse + transpose
//        rows (arrays)  Native columns -> JS values vs JSONCompactEachRow parse
//        rows (objects) Native columns -> objects   vs JSONEachRow parse
//      The Native rows tiers do FULL materialization: every string becomes a
//      JS string (utf8 decode), every value a JS value. No lazy views.
//
// Known asymmetries that remain (inherent, noted in output):
//   - 64-bit ints: Native yields BigInt; ClickHouse JSON quotes them as
//     strings (output_format_json_quote_64bit_integers=1 default).
//   - localhost: network is ~free, so wire-size wins under-count.

import http from 'node:http'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { NativeStreamDecoder, decodeNativeColumns, decodeNativeCount } = require('./ch-core-js.node')
const { createClient } = require('../packages/client-node/dist/index.js')

const CH_HOST = 'localhost'
const CH_PORT = 8123
const N = Number(process.env.ROWS ?? 100000)
const RUNS = Number(process.env.RUNS ?? 7)
const DECODE_ITERS = Number(process.env.DECODE_ITERS ?? 10)
const QUERY = `SELECT id, val, name, flag, small_int, big_uint FROM bench_types ORDER BY id LIMIT ${N}`
const COL_NAMES = ['id', 'val', 'name', 'flag', 'small_int', 'big_uint']
const NEWLINE = 0x0a

const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })

// ClickHouse closes idle keep-alive connections; a request that races that
// close gets ECONNRESET. Retry once on a fresh socket, like real clients do.
async function withReconnectRetry(fn) {
  try {
    return await fn()
  } catch (err) {
    if (err.code === 'ECONNRESET') return fn()
    throw err
  }
}

function rawFetch(sql) {
  const params = new URLSearchParams({ query: sql })
  return withReconnectRetry(
    () =>
      new Promise((resolve, reject) => {
        const req = http.request(
          { host: CH_HOST, port: CH_PORT, method: 'POST', path: '/?' + params.toString(), agent },
          (res) => {
            const chunks = []
            res.on('data', (c) => chunks.push(c))
            res.on('end', () => {
              const body = Buffer.concat(chunks)
              if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode}: ${body}`))
              else resolve(body)
            })
          },
        )
        req.on('error', reject)
        req.end()
      }),
  )
}

// ── Native -> JS materializers ──────────────────────────────────────────────

function columnAccessor(column) {
  let get
  switch (column.kind) {
    case 'Bool': {
      const bm = column.bitmap
      get = (i) => ((bm[i >> 3] >> (i & 7)) & 1) === 1
      break
    }
    case 'String': {
      const data = Buffer.from(column.data.buffer, column.data.byteOffset, column.data.byteLength)
      const offsets = column.offsets
      get = (i) => data.toString('utf8', offsets[i], offsets[i + 1])
      break
    }
    default: {
      const values = column.values
      get = (i) => values[i]
    }
  }
  const v = column.validity
  if (!v) return get
  return (i) => (((v[i >> 3] >> (i & 7)) & 1) === 1 ? get(i) : null)
}

function chunksToRowArrays(chunks) {
  const rows = []
  for (const chunk of chunks) {
    const gets = chunk.columns.map(columnAccessor)
    const w = gets.length
    for (let i = 0; i < chunk.rowCount; i++) {
      const row = new Array(w)
      for (let j = 0; j < w; j++) row[j] = gets[j](i)
      rows.push(row)
    }
  }
  return rows
}

function chunksToRowObjects(chunks) {
  const rows = []
  for (const chunk of chunks) {
    const gets = chunk.columns.map(columnAccessor)
    const names = chunk.columns.map((c) => c.name)
    const w = gets.length
    for (let i = 0; i < chunk.rowCount; i++) {
      const row = {}
      for (let j = 0; j < w; j++) row[names[j]] = gets[j](i)
      rows.push(row)
    }
  }
  return rows
}

// ── JSON parsers (same newline split + JSON.parse the client uses) ─────────

function jsParseRows(buf) {
  const rows = []
  let last = 0
  let idx
  while ((idx = buf.indexOf(NEWLINE, last)) !== -1) {
    rows.push(JSON.parse(buf.subarray(last, idx).toString()))
    last = idx + 1
  }
  return rows
}

function jsParseColumns(buf, numCols) {
  const cols = Array.from({ length: numCols }, () => [])
  let last = 0
  let idx
  while ((idx = buf.indexOf(NEWLINE, last)) !== -1) {
    const row = JSON.parse(buf.subarray(last, idx).toString())
    for (let j = 0; j < numCols; j++) cols[j].push(row[j])
    last = idx + 1
  }
  return cols
}

// ── streamed Native end-to-end (NativeStreamDecoder in a Transform) ────────

function streamNativeFetchDecode(sql, materialize) {
  return withReconnectRetry(() => streamNativeFetchDecodeOnce(sql, materialize))
}

function streamNativeFetchDecodeOnce(sql, materialize) {
  const params = new URLSearchParams({ query: sql })
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: CH_HOST, port: CH_PORT, method: 'POST', path: '/?' + params.toString(), agent },
      (res) => {
        if (res.statusCode !== 200) {
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${Buffer.concat(chunks)}`)))
          return
        }
        const decoder = new NativeStreamDecoder()
        let rows = 0
        const out = []
        const decodeTransform = new Transform({
          readableObjectMode: true,
          transform(chunk, _enc, cb) {
            try {
              for (const c of decoder.push(chunk).chunks) this.push(c)
              cb()
            } catch (err) {
              cb(err)
            }
          },
          flush(cb) {
            try {
              for (const c of decoder.finish().chunks) this.push(c)
              cb()
            } catch (err) {
              cb(err)
            }
          },
        })
        const sink = new Writable({
          objectMode: true,
          write(nativeChunk, _enc, cb) {
            rows += nativeChunk.rowCount
            if (materialize) out.push(...chunksToRowArrays([nativeChunk]))
            cb()
          },
        })
        pipeline(res, decodeTransform, sink)
          .then(() => resolve({ rows, out }))
          .catch(reject)
      },
    )
    req.on('error', reject)
    req.end()
  })
}

// ── timing ──────────────────────────────────────────────────────────────────

const fmt = (ms) => `${ms.toFixed(1)} ms`.padStart(11)
const rate = (ms) => `${Math.round(N / (ms / 1000)).toLocaleString()} rows/s`.padStart(18)
const mb = (b) => (b / 1048576).toFixed(1) + ' MB'
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return { min: s[0], median: s[(s.length / 2) | 0] }
}

// Collect other paths' garbage BEFORE each sample so no path pays another's
// GC debt inside its timing window. Each path's own allocations (and any GC
// they trigger mid-sample) are still measured — that cost is real.
const gcBetweenSamples = typeof globalThis.gc === 'function' ? globalThis.gc : () => {}

async function timeAsync(fn, runs) {
  await fn() // warmup
  const samples = []
  for (let i = 0; i < runs; i++) {
    gcBetweenSamples()
    const t = performance.now()
    await fn()
    samples.push(performance.now() - t)
  }
  return stats(samples)
}

function timeSync(fn, iters) {
  fn() // warmup
  const samples = []
  for (let i = 0; i < iters; i++) {
    gcBetweenSamples()
    const t = performance.now()
    fn()
    samples.push(performance.now() - t)
  }
  return stats(samples)
}

function line(label, s, baseline) {
  const x = baseline ? `  ${(s.median / baseline).toFixed(2)}x` : '  1.00x (baseline)'
  console.log(`  ${label.padEnd(34)} ${fmt(s.median)} ${rate(s.median)}${x}`)
}

// ── run ─────────────────────────────────────────────────────────────────────

console.log(`\nbench_types: ${N.toLocaleString()} rows x 6 cols (Int64, Float64, String, Bool, Int32, UInt64)`)
console.log(`e2e runs: ${RUNS} | decode iters: ${DECODE_ITERS} | medians reported | same raw-HTTP transport everywhere`)
if (typeof globalThis.gc !== 'function') {
  console.log('WARNING: run with node --expose-gc — without per-sample GC isolation, paths pay each other\'s GC debt and numbers are unreliable')
}
console.log()

const nativeBuf = await rawFetch(`${QUERY} FORMAT Native`)
const compactBuf = await rawFetch(`${QUERY} FORMAT JSONCompactEachRow`)
const eachRowBuf = await rawFetch(`${QUERY} FORMAT JSONEachRow`)

console.log('── WIRE SIZE ──')
console.log(`  Native:              ${mb(nativeBuf.length)}  1.00x`)
console.log(`  JSONCompactEachRow:  ${mb(compactBuf.length)}  ${(compactBuf.length / nativeBuf.length).toFixed(2)}x`)
console.log(`  JSONEachRow:         ${mb(eachRowBuf.length)}  ${(eachRowBuf.length / nativeBuf.length).toFixed(2)}x`)

// sanity: both sides agree on the data before we time anything
{
  const nat = chunksToRowArrays(decodeNativeColumns(nativeBuf).chunks)
  const json = jsParseRows(compactBuf)
  if (nat.length !== json.length) throw new Error(`row count mismatch: ${nat.length} vs ${json.length}`)
  for (const i of [0, (nat.length / 2) | 0, nat.length - 1]) {
    const a = nat[i], b = json[i]
    if (
      String(a[0]) !== String(b[0]) || a[1] !== b[1] || a[2] !== b[2] ||
      a[3] !== Boolean(b[3]) || a[4] !== b[4] || String(a[5]) !== String(b[5])
    ) {
      throw new Error(`row ${i} mismatch:\n  native ${JSON.stringify(a, (_, v) => (typeof v === 'bigint' ? String(v) : v))}\n  json   ${JSON.stringify(b)}`)
    }
  }
}

console.log('\n── DECODE-ONLY: -> columns ──')
const dCore = timeSync(() => decodeNativeCount(nativeBuf), DECODE_ITERS)
const dNativeCols = timeSync(() => decodeNativeColumns(nativeBuf), DECODE_ITERS)
const dJsonCols = timeSync(() => jsParseColumns(compactBuf, 6), DECODE_ITERS)
console.log(`  ${'(Rust core floor, count only)'.padEnd(34)} ${fmt(dCore.median)} ${rate(dCore.median)}`)
line('Native -> TypedArray columns', dNativeCols)
line('JSONCompact -> parse+transpose', dJsonCols, dNativeCols.median)

console.log('\n── DECODE-ONLY: -> rows (arrays of JS values, full materialization) ──')
const dNativeRows = timeSync(() => chunksToRowArrays(decodeNativeColumns(nativeBuf).chunks), DECODE_ITERS)
const dJsonRows = timeSync(() => jsParseRows(compactBuf), DECODE_ITERS)
line('Native -> decode -> JS rows', dNativeRows)
line('JSONCompact -> JSON.parse rows', dJsonRows, dNativeRows.median)

console.log('\n── DECODE-ONLY: -> rows (objects keyed by column name) ──')
const dNativeObjs = timeSync(() => chunksToRowObjects(decodeNativeColumns(nativeBuf).chunks), DECODE_ITERS)
const dJsonObjs = timeSync(() => jsParseRows(eachRowBuf), DECODE_ITERS)
line('Native -> decode -> JS objects', dNativeObjs)
line('JSONEachRow -> JSON.parse objects', dJsonObjs, dNativeObjs.median)

console.log('\n── END-TO-END (identical raw HTTP transport): -> columns ──')
const eNativeCols = await timeAsync(async () => decodeNativeColumns(await rawFetch(`${QUERY} FORMAT Native`)), RUNS)
const eNativeColsStream = await timeAsync(() => streamNativeFetchDecode(`${QUERY} FORMAT Native`, false), RUNS)
const eJsonCols = await timeAsync(async () => jsParseColumns(await rawFetch(`${QUERY} FORMAT JSONCompactEachRow`), 6), RUNS)
line('Native buffered -> columns', eNativeCols)
line('Native streamed -> columns', eNativeColsStream, eNativeCols.median)
line('JSONCompact -> columns', eJsonCols, eNativeCols.median)

console.log('\n── END-TO-END (identical raw HTTP transport): -> rows ──')
const eNativeRows = await timeAsync(async () => chunksToRowArrays(decodeNativeColumns(await rawFetch(`${QUERY} FORMAT Native`)).chunks), RUNS)
const eNativeRowsStream = await timeAsync(() => streamNativeFetchDecode(`${QUERY} FORMAT Native`, true), RUNS)
const eJsonRows = await timeAsync(async () => jsParseRows(await rawFetch(`${QUERY} FORMAT JSONCompactEachRow`)), RUNS)
const eNativeObjs = await timeAsync(async () => chunksToRowObjects(decodeNativeColumns(await rawFetch(`${QUERY} FORMAT Native`)).chunks), RUNS)
const eJsonObjs = await timeAsync(async () => jsParseRows(await rawFetch(`${QUERY} FORMAT JSONEachRow`)), RUNS)
line('Native buffered -> row arrays', eNativeRows)
line('Native streamed -> row arrays', eNativeRowsStream, eNativeRows.median)
line('JSONCompact -> row arrays', eJsonRows, eNativeRows.median)
line('Native buffered -> row objects', eNativeObjs)
line('JSONEachRow -> row objects', eJsonObjs, eNativeObjs.median)

console.log('\n── REFERENCE: real @clickhouse/client (what users get today; different transport) ──')
const client = createClient({ url: `http://${CH_HOST}:${CH_PORT}` })
const cCompact = await timeAsync(async () => (await client.query({ query: QUERY, format: 'JSONCompactEachRow' })).json(), RUNS)
const cEachRow = await timeAsync(async () => (await client.query({ query: QUERY, format: 'JSONEachRow' })).json(), RUNS)
line('client JSONCompact .json()', cCompact, eNativeRows.median)
line('client JSONEachRow .json()', cEachRow, eNativeObjs.median)
await client.close()

console.log('\nNotes:')
console.log('  - Ratios compare within the same output shape; reference section ratios are vs the matching Native rows tier.')
console.log('  - Native rows tiers fully materialize JS values (utf8 -> JS strings, bitmap -> booleans).')
console.log('  - 64-bit ints: Native yields BigInt, JSON formats quote them as strings (CH default).')
console.log('  - localhost transport; wire-size advantages (2-3x smaller Native) under-count vs a real network.')
agent.destroy()
