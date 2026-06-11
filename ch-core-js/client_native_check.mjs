// Correctness harness for the experimental client methods queryNativeColumns /
// queryNativeRows (Rust ch-core decode through the real client transport).
//
// Oracle: the same query through client.query({ format: 'JSONEachRow' }).json().
// JSONEachRow carries no meta, so normalization of Native values (BigInt 64-bit
// ints, raw temporal wire values, FixedString Buffers) is driven by the Native
// result's own columnTypes. All temporal columns are UTC-pinned in the query so
// the epoch->string formulas below are timezone-safe.
//
// Also smoke-tests the failure paths the POC must not get wrong:
//   - pre-stream errors  (non-2xx before the body: parsed ClickHouseError)
//   - mid-stream errors  (200 OK, then exception bytes inside the Native body)
//   - abort mid-stream and an already-aborted signal

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createClient } = require('../packages/client-node/dist/index.js');

const N = Number(process.env.ROWS ?? 100000);

const QUERY = `
  SELECT
    number AS id,
    toInt64(number) - 500 AS i64,
    toFloat64(number) / 3 AS val,
    concat('row_', toString(number)) AS name,
    CAST(number % 2 = 0, 'Bool') AS flag,
    toInt32(number % 100000) - 50000 AS small_int,
    toFixedString(leftPad(toString(number % 1000), 8, '0'), 8) AS fxs,
    if(number % 7 = 0, NULL, concat('n_', toString(number))) AS opt_str,
    if(number % 5 = 0, NULL, toInt32(number)) AS opt_i32,
    toDate('2024-01-15') + (number % 1000) AS d,
    toDate32('1969-12-01') + (number % 1000) AS d32,
    toDateTime(1700000000 + number, 'UTC') AS dt,
    addMilliseconds(toDateTime64(1700000000 + number, 3, 'UTC'), number % 1000) AS dt64
  FROM numbers(${N})`;

const client = createClient({ url: 'http://localhost:8123' });

let pass = true;
function check(label, ok, detail) {
  if (!ok) {
    pass = false;
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

// ── Native value -> JSONEachRow-comparable value, driven by the wire type ──

function normalizer(wireType) {
  const m = /^Nullable\((.*)\)$/.exec(wireType);
  const inner = m ? m[1] : wireType;
  let conv;
  if (/^U?Int64$/.test(inner)) {
    // output_format_json_quote_64bit_integers=1: JSON side is a string
    conv = (v) => String(v);
  } else if (/^FixedString\(\d+\)$/.test(inner)) {
    conv = (v) => v.toString('utf8');
  } else if (inner === 'Date' || inner === 'Date32') {
    conv = (v) => new Date(v * 86400000).toISOString().slice(0, 10);
  } else if (/^DateTime(\(|$)/.test(inner)) {
    conv = (v) => new Date(v * 1000).toISOString().slice(0, 19).replace('T', ' ');
  } else if (/^DateTime64\(3[,)]/.test(inner)) {
    conv = (v) => new Date(Number(v)).toISOString().slice(0, 23).replace('T', ' ');
  } else if (/^DateTime64/.test(inner)) {
    throw new Error(`this check only handles DateTime64(3): ${inner}`);
  } else {
    conv = (v) => v;
  }
  return (v) => (v === null ? null : conv(v));
}

// ── main data comparison ────────────────────────────────────────────────────

const native = await client.queryNativeRows({
  query: QUERY,
  clickhouse_settings: { max_block_size: '16384' }, // force multiple Native blocks
});
const oracle = await (
  await client.query({
    query: QUERY,
    format: 'JSONEachRow',
    clickhouse_settings: {
      max_block_size: '16384',
      output_format_json_quote_64bit_integers: 1,
    },
  })
).json();

check('row count (rows vs oracle)', native.rows.length === oracle.length && native.rowCount === oracle.length,
  `native=${native.rowCount}/${native.rows.length} oracle=${oracle.length}`);
check('column names', JSON.stringify(native.columnNames) === JSON.stringify(Object.keys(oracle[0])),
  `native=${native.columnNames} oracle=${Object.keys(oracle[0])}`);
console.log('columnTypes:', native.columnTypes.join(', '));

{
  const norms = native.columnTypes.map(normalizer);
  const names = native.columnNames;
  let mismatches = 0;
  for (let r = 0; r < Math.min(native.rows.length, oracle.length); r++) {
    const nRow = native.rows[r];
    const oRow = oracle[r];
    for (let c = 0; c < names.length; c++) {
      const got = norms[c](nRow[names[c]]);
      const want = oRow[names[c]];
      if (got !== want && mismatches < 5) {
        mismatches++;
        pass = false;
        console.log(`FAIL row ${r} col ${names[c]}: native=${JSON.stringify(got)} oracle=${JSON.stringify(want)}`);
      }
    }
  }
  if (mismatches === 0) console.log(`ok   all ${oracle.length} rows x ${names.length} cols match (objects)`);
}

// rows as positional arrays: spot-check shape + a few cells
{
  const arr = await client.queryNativeRows({ query: `SELECT number AS a, toString(number) AS b FROM numbers(100)`, row_shape: 'arrays' });
  const okShape = Array.isArray(arr.rows[0]) && arr.rows.length === 100;
  const okCells = String(arr.rows[42][0]) === '42' && arr.rows[42][1] === '42';
  check('row_shape arrays', okShape && okCells, JSON.stringify(arr.rows[42], (_, v) => (typeof v === 'bigint' ? String(v) : v)));
}

// columns API: rowCount + zero-copy column shapes survive the same path
{
  const cols = await client.queryNativeColumns({
    query: QUERY,
    clickhouse_settings: { max_block_size: '16384' },
  });
  check('queryNativeColumns rowCount', cols.rowCount === oracle.length, `${cols.rowCount} vs ${oracle.length}`);
  check('queryNativeColumns multiple chunks', cols.chunks.length > 1, `chunks=${cols.chunks.length}`);
  check('queryNativeColumns query_id present', typeof cols.query_id === 'string' && cols.query_id.length > 0);
  const first = cols.chunks[0].columns[0];
  check('zero-copy TypedArray column', first.values instanceof BigUint64Array, String(first.values?.constructor?.name));
}

// trailing single-line comment must not swallow the appended FORMAT clause
{
  const r = await client.queryNativeRows({ query: 'SELECT 42 AS x -- trailing comment' });
  check('trailing -- comment', r.rowCount === 1 && r.rows[0].x === 42, JSON.stringify(r.rows));
}

// a column literally named __proto__ must survive object materialization
// (plain assignment would hit the prototype setter and drop the value)
{
  const r = await client.queryNativeRows({ query: `SELECT 'v' AS \`__proto__\`, 1 AS y` });
  const row = r.rows[0];
  const ok =
    Object.prototype.hasOwnProperty.call(row, '__proto__') &&
    Object.getOwnPropertyDescriptor(row, '__proto__').value === 'v' &&
    row.y === 1 &&
    Object.getPrototypeOf(row) === Object.prototype;
  check('__proto__ column name', ok, JSON.stringify(Object.getOwnPropertyNames(row)));
}

// ── failure paths ───────────────────────────────────────────────────────────

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function expectReject(label, promise, msgRe) {
  try {
    await withTimeout(promise, 30000, label);
    pass = false;
    console.log(`FAIL ${label}: unexpectedly resolved`);
  } catch (err) {
    if (msgRe && !msgRe.test(String(err && err.message))) {
      pass = false;
      console.log(`FAIL ${label}: wrong error: ${err && err.message}`);
    } else {
      console.log(`ok   ${label}: rejected (${String(err && err.message).slice(0, 110)})`);
    }
  }
}

// pre-stream: non-2xx, parsed by the connection layer before any decoding
await expectReject(
  'pre-stream error',
  client.queryNativeColumns({ query: 'SELECT throwIf(1)' }),
  /throwIf/i,
);

// mid-stream: 200 OK with real blocks, then exception bytes in the body
// (same recipe as client-common __tests__/fixtures/stream_errors.ts)
await expectReject(
  'mid-stream error',
  client.queryNativeColumns({
    query: `SELECT toInt32(number) AS n, throwIf(number = 10, 'boom') AS e, sleepEachRow(0.001) FROM system.numbers LIMIT 100`,
    clickhouse_settings: {
      max_block_size: '1',
      http_write_exception_in_output_format: 0,
    },
  }),
  /decode FORMAT Native/i,
);

// abort mid-stream: large result, abort shortly after the request starts
{
  const controller = new AbortController();
  const promise = client.queryNativeColumns({
    query: 'SELECT number, toString(number) AS s FROM numbers(50000000)',
    abort_signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 50);
  const t = performance.now();
  await expectReject('mid-stream abort', promise, /abort/i);
  const elapsed = performance.now() - t;
  check('mid-stream abort is prompt', elapsed < 5000, `${elapsed.toFixed(0)}ms`);
}

// already-aborted signal: must reject immediately, never fetch/decode
{
  const controller = new AbortController();
  controller.abort();
  await expectReject(
    'already-aborted signal',
    client.queryNativeColumns({ query: 'SELECT 1', abort_signal: controller.signal }),
    /abort/i,
  );
}

await client.close();
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
