import type { QueryParams } from '@clickhouse/client-common'
import { TupleParam } from '@clickhouse/client-common'
import { type ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient } from '../utils'

describe('select with query binding', () => {
  let client: ClickHouseClient
  beforeEach(() => {
    client = createTestClient()
  })
  afterEach(async () => {
    await client.close()
  })

  it('can specify a parameterized query', async () => {
    const rs = await client.query({
      query:
        'SELECT number FROM system.numbers WHERE number > {min_limit: UInt64} LIMIT 3',
      format: 'CSV',
      query_params: {
        min_limit: 2,
      },
    })

    const response = await rs.text()
    expect(response).toBe('3\n4\n5\n')
  })

  it('handles boolean in a parameterized query', async () => {
    const rs1 = await client.query({
      query: 'SELECT and({val1: Boolean}, {val2: Boolean})',
      format: 'CSV',
      query_params: {
        val1: true,
        val2: true,
      },
    })

    expect(await rs1.text()).toBe('true\n')

    const rs2 = await client.query({
      query: 'SELECT and({val1: Boolean}, {val2: Boolean})',
      format: 'CSV',
      query_params: {
        val1: true,
        val2: false,
      },
    })

    expect(await rs2.text()).toBe('false\n')
  })

  it('handles numbers in a parameterized query', async () => {
    const rs = await client.query({
      query: 'SELECT plus({val1: Int32}, {val2: Int32})',
      format: 'CSV',
      query_params: {
        val1: 10,
        val2: 20,
      },
    })

    expect(await rs.text()).toBe('30\n')
  })

  it('handles special characters in a parametrized query', async () => {
    const rs = await client.query({
      query: `
        SELECT
          'foo_\t_bar'  = {tab: String}             AS has_tab,
          'foo_\n_bar'  = {newline: String}         AS has_newline,
          'foo_\r_bar'  = {carriage_return: String} AS has_carriage_return,
          'foo_\\'_bar' = {single_quote: String}    AS has_single_quote,
          'foo_\\_bar'  = {backslash: String}       AS has_backslash`,
      format: 'JSONEachRow',
      query_params: {
        tab: 'foo_\t_bar',
        newline: 'foo_\n_bar',
        carriage_return: 'foo_\r_bar',
        single_quote: "foo_'_bar",
        backslash: 'foo_\\_bar',
      },
    })

    expect(await rs.json()).toEqual([
      {
        has_tab: 1,
        has_newline: 1,
        has_carriage_return: 1,
        has_single_quote: 1,
        has_backslash: 1,
      },
    ])
  })

  it('handles tuples in a parametrized query', async () => {
    const rs = await client.query({
      query:
        'SELECT {var: Tuple(Int32, String, String, String, Nullable(String))} AS result',
      format: 'JSONEachRow',
      query_params: {
        var: new TupleParam([42, 'foo', "foo_'_bar", 'foo_\t_bar', null]),
      },
    })
    expect(await rs.json()).toEqual([
      {
        result: [42, 'foo', "foo_'_bar", 'foo_\t_bar', null],
      },
    ])
  })

  it('handles arrays of tuples in a parametrized query', async () => {
    const rs = await client.query({
      query:
        'SELECT {var: Array(Tuple(Int32, String, String, String, Nullable(String)))} AS result',
      format: 'JSONEachRow',
      query_params: {
        var: [new TupleParam([42, 'foo', "foo_'_bar", 'foo_\t_bar', null])],
      },
    })
    expect(await rs.json()).toEqual([
      {
        result: [[42, 'foo', "foo_'_bar", 'foo_\t_bar', null]],
      },
    ])
  })

  it('handles maps with tuples in a parametrized query', async () => {
    const rs = await client.query({
      query:
        'SELECT {var: Map(Int32, Tuple(Int32, String, String, String))} AS result',
      format: 'JSONEachRow',
      query_params: {
        var: new Map([
          [42, new TupleParam([144, 'foo', "foo_'_bar", 'foo_\t_bar'])],
        ]),
      },
    })
    expect(await rs.json()).toEqual([
      {
        result: {
          42: [144, 'foo', "foo_'_bar", 'foo_\t_bar'],
        },
      },
    ])
  })

  it('handles maps with nested arrays in a parametrized query', async () => {
    const rs = await client.query({
      query: 'SELECT {var: Map(Int32, Array(Array(Int32)))} AS result',
      format: 'JSONEachRow',
      query_params: {
        var: new Map([
          [
            42,
            [
              [1, 2, 3],
              [4, 5],
            ],
          ],
        ]),
      },
    })
    expect(await rs.json()).toEqual([
      {
        result: {
          42: [
            [1, 2, 3],
            [4, 5],
          ],
        },
      },
    ])
  })

  it('handles maps with nullable values in a parametrized query', async () => {
    const rs = await client.query({
      query: `
        SELECT {var1: Map(Int32, Nullable(String))} AS var1,
               {var2: Map(String, Nullable(Int32))}  AS var2
      `,
      format: 'JSONEachRow',
      query_params: {
        var1: new Map([
          [42, 'foo'],
          [144, null],
        ]),
        var2: { foo: 42, bar: null },
      },
    })
    expect(await rs.json()).toEqual([
      {
        var1: {
          42: 'foo',
          144: null,
        },
        var2: {
          foo: 42,
          bar: null,
        },
      },
    ])
  })

  describe('Date(Time)', () => {
    it('handles Date in a parameterized query', async () => {
      const rs = await client.query({
        query: 'SELECT toDate({min_time: DateTime})',
        format: 'CSV',
        query_params: {
          min_time: new Date(Date.UTC(2022, 4, 2)),
        },
      })

      const response = await rs.text()
      expect(response).toBe('"2022-05-02"\n')
    })

    it('handles DateTime in a parameterized query', async () => {
      const rs = await client.query({
        query: 'SELECT toDateTime({min_time: DateTime})',
        format: 'CSV',
        query_params: {
          min_time: new Date(Date.UTC(2022, 4, 2, 13, 25, 55)),
        },
      })

      const response = await rs.text()
      expect(response).toBe('"2022-05-02 13:25:55"\n')
    })

    it('handles DateTime64(3) in a parameterized query', async () => {
      const rs = await client.query({
        query: 'SELECT toDateTime64({min_time: DateTime64(3)}, 3)',
        format: 'CSV',
        query_params: {
          min_time: new Date(Date.UTC(2022, 4, 2, 13, 25, 55, 789)),
        },
      })

      const response = await rs.text()
      expect(response).toBe('"2022-05-02 13:25:55.789"\n')
    })

    it('handles DateTime64(6) with timestamp as a string', async () => {
      const rs = await client.query({
        query: `SELECT toDateTime64(toDecimal64({ts: String}, 6), 6, 'Europe/Amsterdam')`,
        format: 'CSV',
        query_params: {
          ts: '1651490755.123456',
        },
      })

      const response = await rs.text()
      expect(response).toBe('"2022-05-02 13:25:55.123456"\n')
    })

    it('handles DateTime64(9) with timestamp as a string', async () => {
      const rs = await client.query({
        query: `SELECT toDateTime64(toDecimal128({ts: String}, 9), 9, 'Europe/Amsterdam')`,
        format: 'CSV',
        query_params: {
          ts: '1651490755.123456789',
        },
      })

      const response = await rs.text()
      expect(response).toBe('"2022-05-02 13:25:55.123456789"\n')
    })
  })

  it('handles an array of strings in a parameterized query', async () => {
    const rs = await client.query({
      query:
        'SELECT arrayConcat({arr1: Array(String)}, {arr2: Array(Nullable(String))})',
      format: 'CSV',
      query_params: {
        arr1: ['1', '2'],
        arr2: ['3', null],
      },
    })

    const response = await rs.text()
    expect(response).toBe(`"['1','2','3',NULL]"\n`)
  })

  it('handles an array of numbers in a parameterized query', async () => {
    const rs = await client.query({
      query: 'SELECT arrayConcat({arr1: Array(Int32)}, {arr2: Array(Int32)})',
      format: 'CSV',
      query_params: {
        arr1: [1, 2],
        arr2: [3, 4],
      },
    })

    const response = await rs.text()
    expect(response).toBe(`"[1,2,3,4]"\n`)
  })

  it('escapes strings in a parameterized query', async () => {
    const rs = await client.query({
      query: 'SELECT concat({str1: String},{str2: String})',
      format: 'CSV',
      query_params: {
        str1: "co'n",
        str2: "ca't",
      },
    })

    const response = await rs.text()
    expect(response).toBe('"co\'nca\'t"\n')
  })

  it('handles an object as a map a parameterized query', async () => {
    const rs = await client.query({
      query: 'SELECT mapKeys({obj: Map(String, UInt32)})',
      format: 'CSV',
      query_params: {
        obj: { id: 42 },
      },
    })

    const response = await rs.text()
    expect(response).toBe(`"['id']"\n`)
  })

  it('should accept non-ASCII symbols in a parameterized query', async () => {
    const rs = await client.query({
      query: 'SELECT concat({str1: String},{str2: String})',
      format: 'CSV',
      query_params: {
        str1: '𝓯𝓸𝓸',
        str2: '𝓫𝓪𝓻',
      },
    })

    const response = await rs.text()
    expect(response).toBe('"𝓯𝓸𝓸𝓫𝓪𝓻"\n')
  })

  describe('Enum', () => {
    it('should accept numeric enums in a parametrized query', async () => {
      enum MyEnum {
        foo = 0,
        bar = 1,
        qaz = 2,
      }

      const rs = await client.query({
        query:
          'SELECT * FROM system.numbers WHERE number = {filter: Int64} LIMIT 1',
        format: 'TabSeparated',
        query_params: {
          filter: MyEnum.qaz, // translated to 2
        },
      })

      const response = await rs.text()
      expect(response).toBe('2\n')
    })

    it('should accept numeric enums in a parametrized query', async () => {
      enum MyEnum {
        foo = 'foo',
        bar = 'bar',
      }

      const rs = await client.query({
        query: 'SELECT concat({str1: String},{str2: String})',
        format: 'TabSeparated',
        query_params: {
          str1: MyEnum.foo,
          str2: MyEnum.bar,
        },
      })

      const response = await rs.text()
      expect(response).toBe('foobar\n')
    })

    // this one is taken from https://clickhouse.com/docs/en/sql-reference/data-types/enum/#usage-examples
    it('should accept the entire enum definition in a parametrized query', async () => {
      const rs = await client.query({
        query: `SELECT toTypeName(CAST('a', {e: String}))`,
        format: 'TabSeparated',
        query_params: {
          e: `Enum('a' = 1, 'b' = 2)`,
        },
      })

      const response = await rs.text()
      expect(response).toBe(`Enum8(\\'a\\' = 1, \\'b\\' = 2)\n`)
    })

    it('should provide error details when sending a request with missing parameter', async () => {
      await expect(
        client.query({
          query: `
            SELECT *
            FROM system.numbers
            WHERE number > {min_limit: UInt64}
            LIMIT 3
          `,
        }),
      ).rejects.toMatchObject({
        message: expect.stringMatching(
          // possible error messages here:
          // (since 23.8+) Substitution `min_limit` is not set.
          // (pre-23.8) Query parameter `min_limit` was not set
          /^.+?`min_limit`.+?not set.*$/,
        ),
        code: '456',
        type: 'UNKNOWN_QUERY_PARAMETER',
      })
    })
  })

  describe('NULL parameter binding', () => {
    const baseQuery: QueryParams = {
      query: 'SELECT number FROM numbers(3) WHERE {n:Nullable(String)} IS NULL',
      format: 'CSV',
    }

    it('should work with nulls', async () => {
      const rs = await client.query({
        ...baseQuery,
        query_params: {
          n: null,
        },
      })

      const response = await rs.text()
      expect(response).toBe('0\n1\n2\n')
    })

    it('should with an explicit undefined', async () => {
      const rs = await client.query({
        ...baseQuery,
        query_params: {
          n: undefined,
        },
      })

      const response = await rs.text()
      expect(response).toBe('0\n1\n2\n')
    })
  })

  describe('Nested boolean types', () => {
    it('handles boolean in an array', async () => {
      const params = {
        foo: [true, false, true],
        bar: [true, null, false],
      }
      const rs = await client.query({
        query: `
          SELECT {foo: Array(Boolean)}           AS foo,
                 {bar: Array(Nullable(Boolean))} AS bar
        `,
        format: 'JSONEachRow',
        query_params: params,
      })

      const response = await rs.json()
      expect(response).toEqual([params])
    })

    it('handles boolean in a tuple', async () => {
      const foo = [1, true, 'foo']
      const bar = [null, 42]
      const params = {
        foo: new TupleParam(foo),
        bar: new TupleParam(bar),
      }

      const rs = await client.query({
        query: `
          SELECT {foo: Tuple(Int32, Boolean, String)}   AS foo,
                 {bar: Tuple(Nullable(Boolean), Int16)} AS bar
        `,
        format: 'JSONEachRow',
        query_params: params,
      })

      const response = await rs.json()
      expect(response).toEqual([{ foo, bar }])
    })

    it('handles boolean in a map', async () => {
      const foo = { item1: true, item2: false }
      const bar = { item1: null, item2: true }
      const params = {
        foo: new Map(Object.entries(foo)),
        bar: new Map(Object.entries(bar)),
      }

      const rs = await client.query({
        query: `
          SELECT {foo: Map(String, Boolean)}           AS foo,
                 {bar: Map(String, Nullable(Boolean))} AS bar
        `,
        format: 'JSONEachRow',
        query_params: params,
      })

      const response = await rs.json()
      expect(response).toEqual([{ foo, bar }])
    })

    it('handles boolean in a mixed nested structure', async () => {
      const rs = await client.query({
        query: `
          SELECT {val: Array(Map(String, Tuple(Int32, Boolean)))} AS result
        `,
        format: 'JSONEachRow',
        query_params: {
          val: [
            { item1: new TupleParam([1, true]) },
            { item2: new TupleParam([2, false]) },
          ],
        },
      })

      const response = await rs.json()
      expect(response).toEqual([
        {
          result: [{ item1: [1, true] }, { item2: [2, false] }],
        },
      ])
    })
  })
})
