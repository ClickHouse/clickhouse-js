import { createClient } from '@clickhouse/client'

/**
 * QBit is a column type that stores float vectors in bit-sliced ("transposed")
 * form so that approximate vector search can read only the most significant
 * bit planes at query time, trading precision for I/O and CPU.
 *
 *   QBit(element_type, dimension)
 *     element_type: BFloat16 | Float32 | Float64
 *     dimension:    number of elements in each vector
 *
 * QBit was introduced in ClickHouse 25.10 as an experimental type (gated by
 * `allow_experimental_qbit_type`) and became GA in 26.x; the setting below is
 * a no-op on newer servers but is required on 25.10.
 *
 * Internally, a QBit column is a `Tuple(FixedString(N), ...)` of bit planes,
 * so the raw bytes are not valid UTF-8. JSON* formats handle this transparently:
 * the server serializes the column as the original numeric array on `SELECT`,
 * and accepts the same array shape on `INSERT`. There is no need to feed raw
 * FixedString bytes through JSON yourself — query the column as a vector and
 * let ClickHouse take care of the bit-plane layout.
 *
 * See https://clickhouse.com/docs/sql-reference/data-types/qbit
 */

const tableName = `chjs_qbit`
const client = createClient({
  clickhouse_settings: {
    // Required on ClickHouse 25.10 (experimental); ignored on 26.x where QBit is GA.
    allow_experimental_qbit_type: 1,
  },
})

await client.command({
  query: `
    CREATE OR REPLACE TABLE ${tableName}
    (
      id  UInt64,
      vec QBit(Float32, 8)
    )
    ENGINE MergeTree
    ORDER BY id
  `,
})

// Even though QBit is stored internally as a Tuple of FixedString bit planes,
// JSON* formats accept (and return) the original Array(Float32) shape.
const values = [
  { id: 1, vec: [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0] },
  { id: 2, vec: [8.0, 7.0, 6.0, 5.0, 4.0, 3.0, 2.0, 1.0] },
  { id: 3, vec: [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5] },
]
await client.insert({
  table: tableName,
  format: 'JSONEachRow',
  values,
})

// Round-trip via JSONEachRow: the vec column comes back as an array of numbers.
const rs = await client.query({
  query: `SELECT id, vec FROM ${tableName} ORDER BY id`,
  format: 'JSONEachRow',
})
console.log('Round-tripped rows:')
console.log(await rs.json())

// Approximate vector search via L2DistanceTransposed.
// The third argument is the precision in bits: lower = less I/O, less accurate.
const search = await client.query({
  query: `
    SELECT id,
           L2DistanceTransposed(vec, {ref:Array(Float32)}, {bits:UInt8}) AS dist
    FROM ${tableName}
    ORDER BY dist ASC
  `,
  query_params: {
    ref: [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0],
    bits: 16,
  },
  format: 'JSONEachRow',
})
console.log('Nearest neighbours of the reference vector:')
console.log(await search.json())

// Bit-plane subcolumns (`vec.N`) are exposed as FixedString and therefore are
// NOT valid UTF-8. Selecting them directly with a JSON* format would force the
// server to escape every byte as a `\uXXXX` sequence, which is rarely useful.
// If you need the raw bit planes, prefer a binary format such as RowBinary,
// or read them as hex/base64:
const planes = await client.query({
  query: `SELECT id, hex(vec.1) AS bit_plane_1_hex FROM ${tableName} ORDER BY id`,
  format: 'JSONEachRow',
})
console.log('First bit plane per row (hex-encoded to keep JSON UTF-8 safe):')
console.log(await planes.json())

await client.close()
