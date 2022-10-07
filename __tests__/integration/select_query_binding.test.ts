import { type ClickHouseClient } from '../../src'
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

  describe('Date(Time)', () => {
    it('handles Date in a parameterized query', async () => {
      const rs = await client.query({
        query: 'SELECT toDate({min_time: DateTime})',
        format: 'CSV',
        query_params: {
          min_time: new Date(2022, 4, 2),
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
          min_time: new Date(2022, 4, 2, 13, 25, 55),
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
          min_time: new Date(2022, 4, 2, 13, 25, 55, 789),
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
      query: 'SELECT arrayConcat({arr1: Array(String)}, {arr2: Array(String)})',
      format: 'CSV',
      query_params: {
        arr1: ['1', '2'],
        arr2: ['3', '4'],
      },
    })

    const response = await rs.text()
    expect(response).toBe(`"['1','2','3','4']"\n`)
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

  it('handles an object a parameterized query', async () => {
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

    it('should provide error details when sending a request with an unknown parameter', async () => {
      await expect(
        client.query({
          query: `
            SELECT * FROM system.numbers
            WHERE number > {min_limit: UInt64} LIMIT 3
          `,
        })
      ).rejects.toEqual(
        expect.objectContaining({
          message: expect.stringContaining(
            'Query parameter `min_limit` was not set'
          ),
          code: '456',
          type: 'UNKNOWN_QUERY_PARAMETER',
        })
      )
    })
  })
})
