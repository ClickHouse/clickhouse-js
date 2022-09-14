import type { ClickHouseClient } from '../../src'
import { createTestClient } from '../utils'
import { v4 } from 'uuid'
import { randomInt } from 'crypto'
import Stream from 'stream'
import { createTableWithFields } from './fixtures/table_with_fields'

describe('data types', () => {
  let client: ClickHouseClient
  beforeEach(() => {
    client = createTestClient()
  })
  afterEach(async () => {
    await client.close()
  })

  it('should work with integer types', async () => {
    const values = [
      {
        i1: 127,
        i2: 32767,
        i3: 2147483647,
        i4: '9223372036854775807',
        i5: '170141183460469231731687303715884105727',
        i6: '57896044618658097711785492504343953926634992332820282019728792003956564819967',
        u1: 255,
        u2: 65535,
        u3: 4294967295,
        u4: '18446744073709551615',
        u5: '340282366920938463463374607431768211455',
        u6: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
      },
      {
        i1: -128,
        i2: -32768,
        i3: -2147483648,
        i4: '-9223372036854775808',
        i5: '-170141183460469231731687303715884105728',
        i6: '-57896044618658097711785492504343953926634992332820282019728792003956564819968',
        u1: 120,
        u2: 1234,
        u3: 51234,
        u4: '421342',
        u5: '15324355',
        u6: '41345135123432',
      },
    ]
    const table = await createTableWithFields(
      client,
      'u1 UInt8, u2 UInt16, u3 UInt32, u4 UInt64, u5 UInt128, u6 UInt256, ' +
        'i1 Int8, i2 Int16, i3 Int32, i4 Int64, i5 Int128, i6 Int256'
    )
    await insertAndAssert(table, values)
  })

  it('should work with floating point types', async () => {
    const values = [
      { f1: 1.234, f2: 3.35245141223232 },
      { f1: -0.7968956, f2: -0.113259394344324 },
    ]
    const table = await createTableWithFields(client, 'f1 Float32, f2 Float64')
    await insertAndAssert(table, values)
  })

  it('should work with boolean', async () => {
    const values = [{ b: true }, { b: false }]
    const table = await createTableWithFields(client, 'b Boolean')
    await insertAndAssert(table, values)
  })

  it('should work with strings', async () => {
    const values = [
      { s: 'foo', fs: 'bar' },
      { s: 'qaz', fs: 'qux' },
    ]
    const table = await createTableWithFields(
      client,
      's String, fs FixedString(3)'
    )
    await insertAndAssert(table, values)
  })

  it('should throw if a value is too large for a FixedString field', async () => {
    const table = await createTableWithFields(client, 'fs FixedString(3)')
    await expect(
      client.insert({
        table,
        values: [{ fs: 'foobar' }],
        format: 'JSONEachRow',
      })
    ).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringContaining('Too large value for FixedString(3)'),
      })
    )
  })

  it('should work with decimals', async () => {
    const stream = new Stream.Readable({
      objectMode: false,
      read() {
        //
      },
    })
    const row1 =
      '1\t1234567.89\t123456789123456.789\t' +
      '1234567891234567891234567891.1234567891\t' +
      '12345678912345678912345678911234567891234567891234567891.12345678911234567891\n'
    const row2 =
      '2\t12.01\t5000000.405\t1.0000000004\t42.00000000000000013007\n'
    stream.push(row1)
    stream.push(row2)
    stream.push(null)
    const table = await createTableWithFields(
      client,
      'd1 Decimal(9, 2), d2 Decimal(18, 3), ' +
        'd3 Decimal(38, 10), d4 Decimal(76, 20)'
    )
    await client.insert({
      table,
      values: stream,
      format: 'TabSeparated',
    })
    const result = await client
      .query({
        query: `SELECT * FROM ${table} ORDER BY id ASC`,
        format: 'TabSeparated',
      })
      .then((r) => r.text())
    expect(result).toEqual(row1 + row2)
  })

  it('should work with UUID', async () => {
    const values = [{ u: v4() }, { u: v4() }]
    const table = await createTableWithFields(client, 'u UUID')
    await insertAndAssert(table, values)
  })

  it('should work with dates', async () => {
    const values = [
      {
        d1: '2149-06-06',
        d2: '2178-04-16',
        dt1: '2106-02-07 06:28:15',
        dt2: '2106-02-07 06:28:15.123',
        dt3: '2106-02-07 06:28:15.123456',
        dt4: '2106-02-07 06:28:15.123456789',
      },
      {
        d1: '2022-09-01',
        d2: '2007-01-29',
        dt1: '2022-09-01 01:40:42',
        dt2: '2021-10-02 03:12:42.123',
        dt3: '2022-12-15 07:10:42.123456',
        dt4: '2008-04-05 03:45:42.123456789',
      },
    ]
    const table = await createTableWithFields(
      client,
      'd1 Date, d2 Date32, dt1 DateTime, ' +
        'dt2 DateTime64(3), dt3 DateTime64(6), dt4 DateTime64(9),'
    )
    await insertAndAssert(table, values)
  })

  it('should work with string enums', async () => {
    const values = [
      { e1: 'Foo', e2: 'Qaz' },
      { e1: 'Bar', e2: 'Qux' },
    ]
    const table = await createTableWithFields(
      client,
      `e1 Enum('Foo', 'Bar'), e2 Enum('Qaz', 'Qux')`
    )
    await insertAndAssert(table, values)
  })

  it('should work with numeric enums', async () => {
    const values = [
      { e1: 42, e2: 100 },
      { e1: 43, e2: 127 },
    ]
    const table = await createTableWithFields(
      client,
      `e1 Enum('Foo' = 42, 'Bar' = 43), e2 Enum('Qaz' = 100, 'Qux' = 127)`
    )
    await insertData(table, values)
    const result = await client
      .query({
        query: `SELECT CAST(e1, 'Int8') AS e1, CAST(e2, 'Int8') AS e2 FROM ${table} ORDER BY id ASC`,
        format: 'JSONEachRow',
      })
      .then((r) => r.json())
    expect(result).toEqual(values)
  })

  it('should work with low cardinality', async () => {
    const values = [
      {
        s: 'foo',
        fs: 'bar',
      },
      {
        s: 'qaz',
        fs: 'qux',
      },
    ]
    const table = await createTableWithFields(
      client,
      's LowCardinality(String), fs LowCardinality(FixedString(3))'
    )
    await insertAndAssert(table, values)
  })

  it('should work with tuples', async () => {
    const values = [
      { t1: ['foo', 42], t2: ['2022-01-04', [1, 2]] },
      { t1: ['bar', 43], t2: ['2015-04-15', [3, 4]] },
    ]
    const table = await createTableWithFields(
      client,
      't1 Tuple(String, Int32), t2 Tuple(Date, Array(Int32))'
    )
    await insertAndAssert(table, values)
  })

  it('should work with nullable types', async () => {
    const values = [
      { s: 'foo', i: null, a: [null, null] },
      { s: null, i: 42, a: [51, null] },
    ]
    const table = await createTableWithFields(
      client,
      's Nullable(String), i Nullable(Int32), a Array(Nullable(Int32))'
    )
    await insertAndAssert(table, values)
  })

  it('should work with IP', async () => {
    const values = [
      {
        ip1: '68.172.195.211',
        ip2: 'f984:5f0b:bf33:e2db:16cd:567c:c1b3:20c4',
      },
      {
        ip1: '184.232.227.132',
        ip2: '2150:c3d5:f9e0:cdee:a94f:4580:d939:3901',
      },
    ]
    const table = await createTableWithFields(client, 'ip1 IPv4, ip2 IPv6')
    await insertAndAssert(table, values)
  })

  it('should work with ((very) nested) arrays', async () => {
    // it's the largest reasonable nesting value (data is generated within 50 ms);
    // 25 here can already tank the performance to ~500ms only to generate the data;
    // 50 simply times out :)
    const maxNestingLevel = 20

    function genNestedArray(level: number): unknown {
      if (level === 1) {
        return [...Array(randomInt(2, 4))].map(() =>
          Math.random().toString(36).slice(2)
        )
      }
      return [...Array(randomInt(1, 3))].map(() => genNestedArray(level - 1))
    }

    function genArrayType(level: number): string {
      if (level === 0) {
        return 'String'
      }
      return `Array(${genArrayType(level - 1)})`
    }

    const values = [
      {
        a1: [42, 43],
        a2: [
          [
            ['qaz', 144],
            ['qux', 1024],
          ],
          [
            ['qwerty', 102],
            ['dvorak', -500],
          ],
        ],
        a3: genNestedArray(maxNestingLevel),
      },
      {
        a1: [44, 56],
        a2: [
          [
            ['rtx', 60],
            ['RDNA', 100],
          ],
          [
            ['zen', 42],
            ['core', 400],
          ],
        ],
        a3: genNestedArray(maxNestingLevel),
      },
    ]
    const table = await createTableWithFields(
      client,
      'a1 Array(Int32), a2 Array(Array(Tuple(String, Int32))), ' +
        `a3 ${genArrayType(maxNestingLevel)}`
    )
    await insertAndAssert(table, values)
  })

  it('should work with ((very) nested) maps', async () => {
    const maxNestingLevel = 10

    function genNestedMap(level: number): unknown {
      const obj: Record<number, unknown> = {}
      if (level === 1) {
        ;[...Array(randomInt(2, 4))].forEach(
          () => (obj[randomInt(1, 1000)] = Math.random().toString(36).slice(2))
        )
        return obj
      }
      ;[...Array(randomInt(1, 3))].forEach(
        () => (obj[randomInt(1, 1000)] = genNestedMap(level - 1))
      )
      return obj
    }

    function genMapType(level: number): string {
      if (level === 0) {
        return 'String'
      }
      return `Map(Int32, ${genMapType(level - 1)})`
    }

    const values = [
      {
        m1: { foo: 'bar', qwe: 'rty' },
        m2: { 1: '2', 3: '4' },
        m3: genNestedMap(maxNestingLevel),
      },
      {
        m1: { qaz: 'qux', sub: 'q' },
        m2: { 3: '4', 4: '5' },
        m3: {},
      },
    ]
    const table = await createTableWithFields(
      client,
      'm1 Map(String, String), m2 Map(Int32, Int64), ' +
        `m3 ${genMapType(maxNestingLevel)}`
    )
    await insertAndAssert(table, values)
  })

  it('should work with (simple) aggregation functions', async () => {
    const values = [
      { route: 53, distance: 20.96 },
      { route: 54, distance: 100.52 },
      { route: 55, distance: 4.05 },
    ]
    const table = await createTableWithFields(
      client,
      `route Int32, distance Decimal(10, 2)`
    )
    await client.insert({
      table,
      values,
      format: 'JSONEachRow',
    })
    expect(
      await client
        .query({
          query: `SELECT sum(distance) FROM ${table}`,
          format: 'TabSeparated',
        })
        .then((r) => r.text())
    ).toEqual('125.53\n')
    expect(
      await client
        .query({
          query: `SELECT max(distance) FROM ${table}`,
          format: 'TabSeparated',
        })
        .then((r) => r.text())
    ).toEqual('100.52\n')
    expect(
      await client
        .query({
          query: `SELECT uniqExact(distance) FROM ${table}`,
          format: 'TabSeparated',
        })
        .then((r) => r.text())
    ).toEqual('3\n')
  })

  it('should work with geo', async () => {
    const values = [
      {
        p: [42, 144],
        r: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        pg: [
          [
            [20, 20],
            [50, 20],
            [50, 50],
            [20, 50],
          ],
          [
            [30, 30],
            [50, 50],
            [50, 30],
          ],
        ],
        mpg: [
          [
            [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
            ],
          ],
          [
            [
              [20, 20],
              [50, 20],
              [50, 50],
              [20, 50],
            ],
            [
              [30, 30],
              [50, 50],
              [50, 30],
            ],
          ],
        ],
      },
    ]
    const table = await createTableWithFields(
      client,
      'p Point, r Ring, pg Polygon, mpg MultiPolygon',
      {
        allow_experimental_geo_types: 1,
      }
    )
    await insertAndAssert(table, values)
  })

  it('should work with JSON', async () => {
    const values = [
      {
        o: { a: 1, b: { c: 2, d: [1, 2, 3] } },
      },
      {
        o: { a: 2, b: { c: 3, d: [4, 5, 6] } },
      },
    ]
    const table = await createTableWithFields(client, 'o JSON', {
      allow_experimental_object_type: 1,
    })
    await insertAndAssert(table, values)
  })

  it.skip('should work with nested', async () => {
    const values = [
      {
        id: 1,
        n: {
          id: 42,
          name: 'foo',
          createdAt: '2001-04-23',
          roles: ['User'],
        },
      },
      {
        id: 2,
        n: {
          id: 43,
          name: 'bar',
          createdAt: '2000-01-12',
          roles: ['Admin'],
        },
      },
    ]
    const table = await createTableWithFields(
      client,
      'n Nested(id UInt32, name String, createdAt DateTime, ' +
        `roles Array(Enum('User', 'Admin')))`
    )
    await client.insert({
      table,
      values,
      format: 'JSONEachRow',
    })
    const result = await client
      .query({
        query: `SELECT n.id, n.name, n.createdAt, n.roles FROM ${table} ORDER BY id ASC`,
        format: 'JSONEachRow',
      })
      .then((r) => r.json())
    expect(result).toEqual([
      {
        'n.id': 42,
        'n.name': 'foo',
        'n.createdAt': '2001-04-23',
        'n.roles': ['User'],
      },
      {
        'n.id': 43,
        'n.name': 'bar',
        'n.createdAt': '2000-01-12',
        'n.roles': ['Admin'],
      },
    ])
  })

  async function insertData<T>(table: string, data: T[]) {
    const values = data.map((v, i) => ({ ...v, id: i + 1 }))
    await client.insert({
      table,
      values,
      format: 'JSONEachRow',
    })
  }

  async function assertData<T>(table: string, data: T[]) {
    const result = await client
      .query({
        query: `SELECT * EXCEPT (id) FROM ${table} ORDER BY id ASC`,
        format: 'JSONEachRow',
      })
      .then((r) => r.json())
    expect(result).toEqual(data)
  }

  async function insertAndAssert<T>(table: string, data: T[]) {
    await insertData(table, data)
    await assertData(table, data)
  }
})
