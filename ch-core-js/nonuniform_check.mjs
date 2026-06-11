// Regression check: a Native stream whose second block has FEWER columns than
// the first must not abort the Node process. The pre-fix decodeNativeColumns
// indexed every chunk with the first block's column count; the resulting Rust
// panic crossed the extern "C" napi trampoline and killed the process with
// SIGABRT. The core now rejects mixed-schema payloads outright
// (DecodeError::BlockSchemaMismatch) on both the one-shot and streaming
// paths, so each must throw an InvalidArg JS Error — never abort, never
// return mixed-schema chunks.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { NativeStreamDecoder, decodeNativeColumns } = require('./ch-core-js.node');

// All lengths below are < 128, so every varint is a single byte.
function block(columns) {
  const parts = [Buffer.from([columns.length, columns[0].values.length])];
  for (const col of columns) {
    parts.push(
      Buffer.from([col.name.length]),
      Buffer.from(col.name, 'utf8'),
      Buffer.from([col.type.length]),
      Buffer.from(col.type, 'utf8'),
      Buffer.from(Int8Array.from(col.values).buffer),
    );
  }
  return Buffer.concat(parts);
}

const buf = Buffer.concat([
  block([
    { name: 'a', type: 'Int8', values: [1, 2] },
    { name: 'b', type: 'Int8', values: [3, 4] },
  ]),
  block([{ name: 'a', type: 'Int8', values: [5] }]),
]);

let pass = true;

function expectSchemaMismatch(label, fn) {
  try {
    const result = fn();
    pass = false;
    console.log(`${label}: unexpectedly succeeded:`, JSON.stringify(result));
  } catch (err) {
    if (err instanceof Error && err.code === 'InvalidArg' && /schema/i.test(err.message)) {
      console.log(`${label}: threw InvalidArg (ok): ${err.message}`);
    } else {
      pass = false;
      console.log(`${label}: wrong error:`, err && err.code, err && err.message);
    }
  }
}

expectSchemaMismatch('decodeNativeColumns', () => decodeNativeColumns(buf).rowCount);

expectSchemaMismatch('NativeStreamDecoder push', () => {
  const dec = new NativeStreamDecoder();
  return dec.push(buf).rowCount;
});

// The mismatch must also surface when the blocks arrive in separate pushes,
// proving the core retains the first block's schema across feeds.
expectSchemaMismatch('NativeStreamDecoder split push', () => {
  const dec = new NativeStreamDecoder();
  const firstLen = block([
    { name: 'a', type: 'Int8', values: [1, 2] },
    { name: 'b', type: 'Int8', values: [3, 4] },
  ]).length;
  dec.push(buf.subarray(0, firstLen));
  return dec.push(buf.subarray(firstLen)).rowCount;
});

// Reaching this line at all is the load-bearing assertion: no SIGABRT.
console.log(pass ? 'PASS (process survived non-uniform blocks)' : 'FAIL');
process.exit(pass ? 0 : 1);
