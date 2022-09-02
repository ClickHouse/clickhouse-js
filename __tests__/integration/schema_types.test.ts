import type { ClickHouseClient } from '../../src'
import { createTableWithSchema, createTestClient, guid } from '../utils'

import * as ch from '../../src/schema'

describe('schema types', () => {
  let client: ClickHouseClient
  let tableName: string

  beforeEach(async () => {
    client = await createTestClient()
    tableName = `schema_test_${guid()}`
  })
  afterEach(async () => {
    await client.close()
  })

  describe('(U)Int', () => {
    const shape = {
      i1: ch.Int8,
      i2: ch.Int16,
      i3: ch.Int32,
      i4: ch.Int64,
      i5: ch.Int128,
      i6: ch.Int256,
      u1: ch.UInt8,
      u2: ch.UInt16,
      u3: ch.UInt32,
      u4: ch.UInt64,
      u5: ch.UInt128,
      u6: ch.UInt256,
    }
    const value: ch.Infer<typeof shape> = {
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
    }

    let table: ch.Table<typeof shape>
    beforeEach(async () => {
      table = await createTableWithSchema(
        client,
        new ch.Schema(shape),
        tableName,
        ['i1']
      )
    })

    it('should insert and select it back', async () => {
      await assertInsertAndSelect(table, value)
    })
  })

  describe('Float', () => {
    const shape = {
      f1: ch.Float32,
      f2: ch.Float64,
    }
    // TODO: figure out better values for this test
    const value: ch.Infer<typeof shape> = {
      f1: 1.2345,
      f2: 2.2345,
    }

    let table: ch.Table<typeof shape>
    beforeEach(async () => {
      table = await createTableWithSchema(
        client,
        new ch.Schema(shape),
        tableName,
        ['f1']
      )
    })

    it('should insert and select it back', async () => {
      await assertInsertAndSelect(table, value)
    })
  })

  describe('String', () => {
    const shape = {
      s1: ch.String,
      s2: ch.FixedString(255),
    }
    const value: ch.Infer<typeof shape> = {
      s1: 'foo',
      s2: 'bar',
    }

    let table: ch.Table<typeof shape>
    beforeEach(async () => {
      table = await createTableWithSchema(
        client,
        new ch.Schema(shape),
        tableName,
        ['s1']
      )
    })

    it('should insert and select it back', async () => {
      await table.insert({
        values: [value],
      })
      const result = await (await table.select()).json()
      expect(result).toEqual([
        {
          s1: value.s1,
          s2: value.s2.padEnd(255, '\x00'),
        },
      ])
      expect(result[0].s2.length).toEqual(255)
    })
  })

  describe('IP', () => {
    const shape = {
      ip1: ch.IPv4,
      ip2: ch.IPv6,
    }
    const value: ch.Infer<typeof shape> = {
      ip1: '127.0.0.116',
      ip2: '2001:db8:85a3::8a2e:370:7334',
    }

    let table: ch.Table<typeof shape>
    beforeEach(async () => {
      table = await createTableWithSchema(
        client,
        new ch.Schema(shape),
        tableName,
        ['ip1']
      )
    })

    it('should insert and select it back', async () => {
      await assertInsertAndSelect(table, value)
    })
  })

  describe('Array', () => {
    const shape = {
      arr1: ch.Array(ch.UInt32),
      arr2: ch.Array(ch.String),
      arr3: ch.Array(ch.Array(ch.Array(ch.Int32))),
      arr4: ch.Array(ch.Nullable(ch.String)),
    }
    // TODO:  better values for this test
    const value: ch.Infer<typeof shape> = {
      arr1: [1, 2],
      arr2: ['foo', 'bar'],
      arr3: [[[12345]]],
      arr4: ['qux', null, 'qaz'],
    }

    let table: ch.Table<typeof shape>
    beforeEach(async () => {
      table = await createTableWithSchema(
        client,
        new ch.Schema(shape),
        tableName,
        ['arr2']
      )
    })

    it('should insert and select it back', async () => {
      await assertInsertAndSelect(table, value)
    })
  })

  describe('Map', () => {
    const shape = {
      m1: ch.Map(ch.String, ch.String),
      m2: ch.Map(ch.Int32, ch.Map(ch.Date, ch.Array(ch.Int32))),
    }
    const value: ch.Infer<typeof shape> = {
      m1: { foo: 'bar' },
      m2: {
        42: {
          '2022-04-25': [1, 2, 3],
        },
      },
    }

    let table: ch.Table<typeof shape>
    beforeEach(async () => {
      table = await createTableWithSchema(
        client,
        new ch.Schema(shape),
        tableName,
        ['m1']
      )
    })

    it('should insert and select it back', async () => {
      await assertInsertAndSelect(table, value)
    })
  })

  describe('Nullable', () => {
    const shape = {
      id: ch.Int32, // nullable order by is prohibited
      n1: ch.Nullable(ch.String),
      n2: ch.Nullable(ch.Date),
    }
    const value1: ch.Infer<typeof shape> = {
      id: 1,
      n1: 'foo',
      n2: null,
    }
    const value2: ch.Infer<typeof shape> = {
      id: 2,
      n1: null,
      n2: '2022-04-30',
    }

    let table: ch.Table<typeof shape>
    beforeEach(async () => {
      table = await createTableWithSchema(
        client,
        new ch.Schema(shape),
        tableName,
        ['id']
      )
    })

    it('should insert and select it back', async () => {
      await assertInsertAndSelect(table, value1, value2)
    })
  })

  describe('Enum', () => {
    enum MyEnum {
      Foo = 'Foo',
      Bar = 'Bar',
      Qaz = 'Qaz',
      Qux = 'Qux',
    }

    const shape = {
      id: ch.Int32, // to preserve the order of values
      e: ch.Enum(MyEnum),
    }
    const values: ch.Infer<typeof shape>[] = [
      { id: 1, e: MyEnum.Bar },
      { id: 2, e: MyEnum.Qux },
      { id: 3, e: MyEnum.Foo },
      { id: 4, e: MyEnum.Qaz },
    ]

    let table: ch.Table<typeof shape>
    beforeEach(async () => {
      table = await createTableWithSchema(
        client,
        new ch.Schema(shape),
        tableName,
        ['id']
      )
    })

    it('should insert and select it back', async () => {
      await assertInsertAndSelect(table, ...values)
    })

    it('should fail in case of an invalid value', async () => {
      await expect(
        table.insert({
          values: [{ id: 4, e: 'NonExistingValue' as MyEnum }],
        })
      ).rejects.toMatchObject(
        expect.objectContaining({
          message: expect.stringContaining(
            `Unknown element 'NonExistingValue' for enum`
          ),
        })
      )
    })
  })

  describe('Date(Time)', () => {
    const shape = {
      d1: ch.Date,
      d2: ch.Date32,
      dt1: ch.DateTime(),
      dt2: ch.DateTime64(3),
      dt3: ch.DateTime64(6),
      dt4: ch.DateTime64(9),
    }
    const value: ch.Infer<typeof shape> = {
      d1: '2149-06-06',
      d2: '2178-04-16',
      dt1: '2106-02-07 06:28:15',
      dt2: '2106-02-07 06:28:15.123',
      dt3: '2106-02-07 06:28:15.123456',
      dt4: '2106-02-07 06:28:15.123456789',
    }

    let table: ch.Table<typeof shape>
    beforeEach(async () => {
      table = await createTableWithSchema(
        client,
        new ch.Schema(shape),
        tableName,
        ['d1']
      )
    })

    it('should insert and select it back', async () => {
      await assertInsertAndSelect(table, value)
    })
  })

  // FIXME: uncomment and extend the test
  //  once Decimal is re-implemented properly

  // describe('Decimal', () => {
  //   const shape = {
  //     d1: ch.Decimal({
  //       precision: 9,
  //       scale: 2,
  //     }), // Decimal32
  //     d2: ch.Decimal({
  //       precision: 18,
  //       scale: 3,
  //     }), // Decimal64
  //   }
  //   const value: ch.Infer<typeof shape> = {
  //     d1: 1234567.89,
  //     d2: 123456789123456.789,
  //   }
  //
  //   let table: ch.Table<typeof shape>
  //   beforeEach(async () => {
  //     table = await createTableWithSchema(
  //       client,
  //       new ch.Schema(shape),
  //       tableName,
  //       ['d1']
  //     )
  //   })
  //
  //   it('should insert and select it back', async () => {
  //     await assertInsertAndSelect(table, value)
  //   })
  // })

  describe('LowCardinality', () => {
    const shape = {
      lc1: ch.LowCardinality(ch.String),
    }
    const value: ch.Infer<typeof shape> = {
      lc1: 'foobar',
    }

    let table: ch.Table<typeof shape>
    beforeEach(async () => {
      table = await createTableWithSchema(
        client,
        new ch.Schema(shape),
        tableName,
        ['lc1']
      )
    })

    it('should insert and select it back', async () => {
      await assertInsertAndSelect(table, value)
    })
  })
})

async function assertInsertAndSelect<S extends ch.Shape>(
  table: ch.Table<S>,
  ...value: ch.Infer<S>[]
) {
  await table.insert({
    values: value,
  })
  const result = await (await table.select()).json()
  expect(result).toEqual(value)
}
