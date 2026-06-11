// Zero-copy lifetime + nullable correctness check for the external-ArrayBuffer
// columnar export. Run with: node --expose-gc zerocopy_check.mjs
//
// What this proves that verify.mjs does not:
//   1. Nullable columns: the validity bitmap is now an external (zero-copy) view.
//   2. GC survival: after the decode result is dropped and GC is forced hard, a
//      retained typed-array view still reads correct bytes. If the finalizer's
//      Arc<ColBatch> were captured wrong, the backing Vec would be freed and we
//      would read garbage (or crash). Correct values after GC == lifetime is sound.

import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { decodeNativeColumns } = require('./ch-core-js.node');

const CH_HOST = 'localhost';
const CH_PORT = 8123;
const N = Number(process.env.ROWS ?? 50000);

if (typeof global.gc !== 'function') {
  console.error('Run with --expose-gc:  node --expose-gc zerocopy_check.mjs');
  process.exit(2);
}

function chQuery(sql) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ query: sql });
    const req = http.request(
      { host: CH_HOST, port: CH_PORT, method: 'POST', path: '/?' + params.toString() },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          else resolve(body);
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function forceGc(rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    // Allocate churn so V8 actually collects the dropped decode result and runs
    // the external-arraybuffer finalizers.
    const junk = new Array(2_000_000);
    for (let j = 0; j < junk.length; j += 997) junk[j] = { j };
    global.gc();
  }
}

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name}`);
    failures++;
  }
}

// id = 0..N-1; nullable Int32 null on multiples of 3; nullable String null on evens.
const QUERY =
  `SELECT number AS id, ` +
  `if(number % 3 = 0, NULL, toInt32(number * 2)) AS maybe_int, ` +
  `if(number % 2 = 0, NULL, toString(number)) AS maybe_str ` +
  `FROM numbers(${N})`;

function bitSet(validity, i) {
  return ((validity[i >> 3] >> (i & 7)) & 1) === 1;
}

// ---- Sub-test 1: nullable correctness (validity exported as external view) ----
async function nullableCorrectness() {
  console.log(`\n[nullable correctness] ${N} rows`);
  const buf = await chQuery(QUERY + ' FORMAT Native');
  const res = decodeNativeColumns(buf);

  check('column types', JSON.stringify(res.columnTypes) ===
    JSON.stringify(['UInt64', 'Nullable(Int32)', 'Nullable(String)']));

  // Walk chunks, validate every row against the deterministic generator.
  let row = 0;
  let intNulls = 0;
  let strNulls = 0;
  for (const chunk of res.chunks) {
    const id = chunk.columns.find((c) => c.name === 'id').values;
    const mi = chunk.columns.find((c) => c.name === 'maybe_int');
    const ms = chunk.columns.find((c) => c.name === 'maybe_str');
    for (let r = 0; r < chunk.rowCount; r++, row++) {
      if (id[r] !== BigInt(row)) { check(`id[${row}]`, false); return; }

      const intValid = bitSet(mi.validity, r);
      const wantIntNull = row % 3 === 0;
      if (intValid === wantIntNull) { check(`maybe_int validity row ${row}`, false); return; }
      if (intValid && mi.values[r] !== row * 2) { check(`maybe_int value row ${row}`, false); return; }
      if (!intValid) intNulls++;

      const strValid = bitSet(ms.validity, r);
      const wantStrNull = row % 2 === 0;
      if (strValid === wantStrNull) { check(`maybe_str validity row ${row}`, false); return; }
      if (strValid) {
        const s = Buffer.from(ms.data.subarray(ms.offsets[r], ms.offsets[r + 1])).toString('utf8');
        if (s !== String(row)) { check(`maybe_str value row ${row}`, false); return; }
      }
      if (!strValid) strNulls++;
    }
  }
  check(`all ${row} rows validated`, row === N);
  check('int null count', intNulls === Math.ceil(N / 3));
  check('str null count', strNulls === Math.ceil(N / 2));
}

// ---- Sub-test 2: GC survival of a retained view after the result is dropped ----
async function gcSurvival() {
  console.log('\n[gc survival] retain one column view, drop result, force GC');
  const buf = await chQuery(`SELECT number AS id FROM numbers(${N}) FORMAT Native`);

  // Capture an independent oracle (plain JS numbers) before anything is dropped.
  const expectedFirst = 0n;
  const expectedLast = BigInt(N - 1);
  let expectedSum = 0n;
  for (let i = 0; i < N; i++) expectedSum += BigInt(i);

  // Keep ONLY the first chunk's id view; let the rest of the result die.
  let view;
  {
    const res = decodeNativeColumns(buf);
    view = res.chunks[0].columns.find((c) => c.name === 'id').values; // BigInt64Array, zero-copy
    // res goes out of scope here; only `view` (and its backing ArrayBuffer) survive.
  }
  const firstChunkRows = view.length;

  forceGc();

  // After GC, the retained view must still hold correct bytes.
  let sum = 0n;
  let ok = true;
  for (let i = 0; i < view.length; i++) {
    if (view[i] !== BigInt(i)) { ok = false; break; }
    sum += view[i];
  }
  check('retained view first element', view[0] === expectedFirst);
  check('retained view last-in-chunk element', view[firstChunkRows - 1] === BigInt(firstChunkRows - 1));
  check('retained view all elements correct after GC', ok);

  // Whole-result survival: keep every chunk's view, drop result handle, GC, sum.
  const views = [];
  {
    const res = decodeNativeColumns(buf);
    for (const chunk of res.chunks) {
      views.push(chunk.columns.find((c) => c.name === 'id').values);
    }
  }
  forceGc();
  let total = 0n;
  let count = 0;
  for (const v of views) for (let i = 0; i < v.length; i++) { total += v[i]; count++; }
  check('all-chunk views row count after GC', count === N);
  check('all-chunk views checksum after GC', total === expectedSum);
  void expectedLast;
}

await nullableCorrectness();
await gcSurvival();

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
