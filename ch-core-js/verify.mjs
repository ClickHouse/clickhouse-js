// Correctness harness for the Native N-API columnar and streaming prototypes.
//
// The streaming decoder is fed deliberately awkward byte slices so a Native block
// is usually incomplete at push boundaries. Validity uses Arrow convention:
// bit=1 means valid, bit=0 means null.

import http from 'node:http';
import { TextDecoder } from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { NativeStreamDecoder, decodeNativeColumns, decodeNativeCount } = require('./ch-core-js.node');

const CH_HOST = 'localhost';
const CH_PORT = 8123;
const N = Number(process.env.ROWS ?? 100000);
const STREAM_SLICE_BYTES = Number(process.env.STREAM_SLICE_BYTES ?? 7777);
const QUERY =
  `SELECT id, val, name, flag, small_int, big_uint, ` +
  `toDate('2024-01-15') + (id % 1000) AS d, ` +
  `toDate32('1969-12-01') + (id % 1000) AS d32, ` +
  `toDateTime(1700000000 + id, 'UTC') AS dt, ` +
  `addMilliseconds(toDateTime64(1700000000 + id, 3, 'UTC'), id % 1000) AS dt64 ` +
  `FROM bench_types ORDER BY id LIMIT ${N}`;

const decoder = new TextDecoder();

function chQuery(sql, extraParams = {}) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ query: sql, ...extraParams });
    const req = http.request(
      {
        host: CH_HOST,
        port: CH_PORT,
        method: 'POST',
        path: '/?' + params.toString(),
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${body.toString('utf8')}`));
          } else {
            resolve(body);
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function is64BitType(type) {
  return /\bU?Int64\b/.test(type);
}

// ClickHouse (verified on 26.2) drops the timezone from DateTime on the Native
// wire — `toDateTime(x, 'UTC')`, CAST, and toTimeZone all serialize the column
// type as bare "DateTime", while JSON meta reports "DateTime('UTC')".
// DateTime64 keeps its timezone on the wire. The decoder reports wire truth,
// so normalize the JSON-side expectation to what the Native header carries.
function nativeWireType(type) {
  return type.replace(/^DateTime\('[^']*'\)$/, 'DateTime');
}

function bitIsSet(bytes, index) {
  return ((bytes[index >> 3] >> (index & 7)) & 1) === 1;
}

function packedByteLength(bits) {
  return Math.ceil(bits / 8);
}

function valueAt(column, rowIndex) {
  if (column.validity && !bitIsSet(column.validity, rowIndex)) {
    return null;
  }

  switch (column.kind) {
    case 'Bool':
      return bitIsSet(column.bitmap, rowIndex);
    case 'Int8':
    case 'Int16':
    case 'Int32':
    case 'UInt8':
    case 'UInt16':
    case 'UInt32':
    case 'Float32':
    case 'Float64':
    case 'Int64':
    case 'UInt64':
      return column.values[rowIndex];
    case 'String': {
      const start = column.offsets[rowIndex];
      const end = column.offsets[rowIndex + 1];
      return decoder.decode(column.data.subarray(start, end));
    }
    case 'FixedString': {
      const start = rowIndex * column.width;
      const end = start + column.width;
      return Buffer.from(column.data.subarray(start, end));
    }
    // Temporal kinds are normalized to the strings ClickHouse emits in
    // JSONCompact (UTC-pinned in the query) so they compare against the oracle.
    case 'Date':
    case 'Date32':
      return new Date(column.values[rowIndex] * 86400000).toISOString().slice(0, 10);
    case 'DateTime':
      return new Date(column.values[rowIndex] * 1000).toISOString().slice(0, 19).replace('T', ' ');
    case 'DateTime64':
      // values are BigInt64 ticks at the column's precision; the query uses precision 3 (ms).
      return new Date(Number(column.values[rowIndex])).toISOString().slice(0, 23).replace('T', ' ');
    default:
      throw new Error(`Unsupported column kind in verifier: ${column.kind}`);
  }
}

function reconstructRows(chunks) {
  const rows = [];
  for (const chunk of chunks) {
    for (let rowIndex = 0; rowIndex < chunk.rowCount; rowIndex++) {
      rows.push(chunk.columns.map((column) => valueAt(column, rowIndex)));
    }
  }
  return rows;
}

function cellEq(a, b) {
  if (a === null || b === null) return a === b;
  if (typeof a === 'bigint' || typeof b === 'bigint') {
    return typeof a === 'bigint' && typeof b === 'bigint' && a === b;
  }
  if (Buffer.isBuffer(a) || Buffer.isBuffer(b)) {
    return Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.equals(b);
  }
  return a === b;
}

function compareRows(decodedRows, oracleRows, columnNames, label) {
  let pass = true;
  const mismatches = [];

  if (decodedRows.length !== oracleRows.length) {
    pass = false;
    console.log(`${label} row count mismatch: decoded=${decodedRows.length} oracle=${oracleRows.length}`);
  }

  const rowCount = Math.min(decodedRows.length, oracleRows.length);
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < oracleRows[r].length; c++) {
      if (!cellEq(decodedRows[r][c], oracleRows[r][c])) {
        pass = false;
        if (mismatches.length < 5) {
          mismatches.push({
            row: r,
            col: columnNames[c],
            decoded: typeof decodedRows[r][c] === 'bigint' ? `${decodedRows[r][c]}n` : decodedRows[r][c],
            oracle: typeof oracleRows[r][c] === 'bigint' ? `${oracleRows[r][c]}n` : oracleRows[r][c],
          });
        }
      }
    }
  }

  if (mismatches.length) {
    console.log(`${label} first mismatches:`, mismatches);
  }
  return pass;
}

function checkColumnStructure(errors, column, rowCount, columnIndex, chunkIndex) {
  const label = `chunk ${chunkIndex} column ${columnIndex} (${column.name})`;
  if (column.validity !== undefined) {
    if (!(column.validity instanceof Uint8Array)) {
      errors.push(`${label}: validity is not Uint8Array`);
    } else if (column.validity.length !== packedByteLength(rowCount)) {
      errors.push(`${label}: validity length ${column.validity.length} != ${packedByteLength(rowCount)}`);
    }
  }

  switch (column.kind) {
    case 'Bool':
      if (column.length !== rowCount) errors.push(`${label}: Bool length mismatch`);
      if (!(column.bitmap instanceof Uint8Array)) errors.push(`${label}: bitmap is not Uint8Array`);
      else if (column.bitmap.length !== packedByteLength(rowCount)) {
        errors.push(`${label}: bitmap length ${column.bitmap.length} != ${packedByteLength(rowCount)}`);
      }
      break;
    case 'Int8':
      if (!(column.values instanceof Int8Array)) errors.push(`${label}: values is not Int8Array`);
      else if (column.values.length !== rowCount) errors.push(`${label}: values length mismatch`);
      break;
    case 'Int16':
      if (!(column.values instanceof Int16Array)) errors.push(`${label}: values is not Int16Array`);
      else if (column.values.length !== rowCount) errors.push(`${label}: values length mismatch`);
      break;
    case 'Int32':
      if (!(column.values instanceof Int32Array)) errors.push(`${label}: values is not Int32Array`);
      else if (column.values.length !== rowCount) errors.push(`${label}: values length mismatch`);
      break;
    case 'Int64':
      if (!(column.values instanceof BigInt64Array)) errors.push(`${label}: values is not BigInt64Array`);
      else if (column.values.length !== rowCount) errors.push(`${label}: values length mismatch`);
      break;
    case 'UInt8':
      if (!(column.values instanceof Uint8Array)) errors.push(`${label}: values is not Uint8Array`);
      else if (column.values.length !== rowCount) errors.push(`${label}: values length mismatch`);
      break;
    case 'UInt16':
      if (!(column.values instanceof Uint16Array)) errors.push(`${label}: values is not Uint16Array`);
      else if (column.values.length !== rowCount) errors.push(`${label}: values length mismatch`);
      break;
    case 'UInt32':
      if (!(column.values instanceof Uint32Array)) errors.push(`${label}: values is not Uint32Array`);
      else if (column.values.length !== rowCount) errors.push(`${label}: values length mismatch`);
      break;
    case 'UInt64':
      if (!(column.values instanceof BigUint64Array)) errors.push(`${label}: values is not BigUint64Array`);
      else if (column.values.length !== rowCount) errors.push(`${label}: values length mismatch`);
      break;
    case 'Float32':
      if (!(column.values instanceof Float32Array)) errors.push(`${label}: values is not Float32Array`);
      else if (column.values.length !== rowCount) errors.push(`${label}: values length mismatch`);
      break;
    case 'Float64':
      if (!(column.values instanceof Float64Array)) errors.push(`${label}: values is not Float64Array`);
      else if (column.values.length !== rowCount) errors.push(`${label}: values length mismatch`);
      break;
    case 'String':
      if (!(column.offsets instanceof Int32Array)) errors.push(`${label}: offsets is not Int32Array`);
      else {
        if (column.offsets.length !== rowCount + 1) errors.push(`${label}: offsets length mismatch`);
        if (column.offsets[0] !== 0) errors.push(`${label}: offsets[0] is not 0`);
      }
      if (!(column.data instanceof Uint8Array)) errors.push(`${label}: data is not Uint8Array`);
      break;
    case 'FixedString':
      if (!(column.data instanceof Uint8Array)) errors.push(`${label}: data is not Uint8Array`);
      else if (column.data.length !== rowCount * column.width) {
        errors.push(`${label}: FixedString data length mismatch`);
      }
      break;
    case 'Date':
      if (!(column.values instanceof Uint16Array)) errors.push(`${label}: values is not Uint16Array`);
      else if (column.values.length !== rowCount) errors.push(`${label}: values length mismatch`);
      break;
    case 'Date32':
      if (!(column.values instanceof Int32Array)) errors.push(`${label}: values is not Int32Array`);
      else if (column.values.length !== rowCount) errors.push(`${label}: values length mismatch`);
      break;
    case 'DateTime':
      if (!(column.values instanceof Uint32Array)) errors.push(`${label}: values is not Uint32Array`);
      else if (column.values.length !== rowCount) errors.push(`${label}: values length mismatch`);
      break;
    case 'DateTime64':
      if (!(column.values instanceof BigInt64Array)) errors.push(`${label}: values is not BigInt64Array`);
      else if (column.values.length !== rowCount) errors.push(`${label}: values length mismatch`);
      break;
    default:
      errors.push(`${label}: unsupported kind ${column.kind}`);
  }
}

function checkResultStructure(result, oracleNames, oracleTypes, label) {
  const errors = [];
  if (JSON.stringify(result.columnNames) !== JSON.stringify(oracleNames)) {
    errors.push(`${label}: columnNames=${JSON.stringify(result.columnNames)} oracle=${JSON.stringify(oracleNames)}`);
  }
  if (JSON.stringify(result.columnTypes) !== JSON.stringify(oracleTypes)) {
    errors.push(`${label}: columnTypes=${JSON.stringify(result.columnTypes)} oracle=${JSON.stringify(oracleTypes)}`);
  }
  const chunkRowSum = result.chunks.reduce((sum, chunk) => sum + chunk.rowCount, 0);
  if (chunkRowSum !== result.rowCount) {
    errors.push(`${label}: sum(chunk.rowCount)=${chunkRowSum} rowCount=${result.rowCount}`);
  }
  if (result.chunks.length <= 1) {
    errors.push(`${label}: expected multiple Native chunks, got ${result.chunks.length}`);
  }

  result.chunks.forEach((chunk, chunkIndex) => {
    if (chunk.columns.length !== oracleNames.length) {
      errors.push(`${label} chunk ${chunkIndex}: columns=${chunk.columns.length} oracle=${oracleNames.length}`);
    }
    chunk.columns.forEach((column, columnIndex) => {
      if (column.name !== oracleNames[columnIndex]) {
        errors.push(`${label} chunk ${chunkIndex} column ${columnIndex}: name=${column.name} oracle=${oracleNames[columnIndex]}`);
      }
      if (column.type !== oracleTypes[columnIndex]) {
        errors.push(`${label} chunk ${chunkIndex} column ${columnIndex}: type=${column.type} oracle=${oracleTypes[columnIndex]}`);
      }
      checkColumnStructure(errors, column, chunk.rowCount, columnIndex, chunkIndex);
    });
  });

  if (errors.length) {
    console.log(`${label} structural errors:`, errors.slice(0, 20));
  }
  return errors.length === 0;
}

function decodeStreamFromBuffer(buf, sliceBytes) {
  const streamDecoder = new NativeStreamDecoder();
  const chunks = [];
  let rowCount = 0;
  let columnNames = [];
  let columnTypes = [];
  let maxBufferedBytes = 0;
  let pushesWithChunks = 0;

  for (let offset = 0; offset < buf.length; offset += sliceBytes) {
    const out = streamDecoder.push(buf.subarray(offset, Math.min(offset + sliceBytes, buf.length)));
    if (out.columnNames.length) {
      columnNames = out.columnNames;
      columnTypes = out.columnTypes;
    }
    if (out.chunks.length) pushesWithChunks++;
    chunks.push(...out.chunks);
    rowCount += out.rowCount;
    maxBufferedBytes = Math.max(maxBufferedBytes, streamDecoder.bufferedBytes);
  }

  const final = streamDecoder.finish();
  chunks.push(...final.chunks);
  rowCount += final.rowCount;
  maxBufferedBytes = Math.max(maxBufferedBytes, streamDecoder.bufferedBytes);
  if (final.columnNames.length) {
    columnNames = final.columnNames;
    columnTypes = final.columnTypes;
  }

  if (streamDecoder.rowCount !== rowCount) {
    throw new Error(`stream decoder rowCount getter ${streamDecoder.rowCount} != emitted ${rowCount}`);
  }

  return { rowCount, columnNames, columnTypes, chunks, maxBufferedBytes, pushesWithChunks };
}

const nativeBuf = await chQuery(`${QUERY} FORMAT Native`);
const buffered = decodeNativeColumns(nativeBuf);
const coreCount = decodeNativeCount(nativeBuf);
const streamed = decodeStreamFromBuffer(nativeBuf, STREAM_SLICE_BYTES);

const jsonBuf = await chQuery(`${QUERY} FORMAT JSONCompact`, {
  output_format_json_quote_64bit_integers: '1',
});
const oracle = JSON.parse(jsonBuf.toString('utf8'));

const oracleNames = oracle.meta.map((m) => m.name);
const oracleTypes = oracle.meta.map((m) => m.type).map(nativeWireType);
const is64Bit = oracleTypes.map(is64BitType);
const oracleRows = oracle.data.map((row) =>
  row.map((cell, ci) => {
    if (cell === null) return null;
    if (is64Bit[ci]) return BigInt(cell);
    return cell;
  }),
);

let pass = true;
if (coreCount !== oracleRows.length) {
  pass = false;
  console.log(`decodeNativeCount mismatch: decoded=${coreCount} oracle=${oracleRows.length}`);
}
if (buffered.rowCount !== oracleRows.length) {
  pass = false;
  console.log(`buffered row count mismatch: decoded=${buffered.rowCount} oracle=${oracleRows.length}`);
}
if (streamed.rowCount !== oracleRows.length) {
  pass = false;
  console.log(`streamed row count mismatch: decoded=${streamed.rowCount} oracle=${oracleRows.length}`);
}

pass = checkResultStructure(buffered, oracleNames, oracleTypes, 'buffered') && pass;
pass = checkResultStructure(streamed, oracleNames, oracleTypes, 'streamed') && pass;
pass = compareRows(reconstructRows(buffered.chunks), oracleRows, oracleNames, 'buffered') && pass;
pass = compareRows(reconstructRows(streamed.chunks), oracleRows, oracleNames, 'streamed') && pass;

console.log('rows:', oracleRows.length);
console.log('decodeNativeCount:', coreCount);
console.log('columnNames:', buffered.columnNames);
console.log('columnTypes:', buffered.columnTypes);
console.log('buffered chunks:', buffered.chunks.map((chunk) => chunk.rowCount));
console.log('streamed chunks:', streamed.chunks.map((chunk) => chunk.rowCount));
console.log('stream slice bytes:', STREAM_SLICE_BYTES);
console.log('stream pushes with emitted chunks:', streamed.pushesWithChunks);
console.log('stream max buffered bytes:', streamed.maxBufferedBytes);
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
