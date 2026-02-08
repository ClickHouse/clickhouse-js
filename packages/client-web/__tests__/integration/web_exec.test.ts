import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient } from '@test/utils'
import { getAsText } from '../../src/utils'
import { ResultSet } from '../../src'

describe('[Web] exec result streaming', () => {
  let client: ClickHouseClient<ReadableStream>
  beforeEach(() => {
    client = createTestClient()
  })
  afterEach(async () => {
    await client.close()
  })

  it('should send a parametrized query', async () => {
    const result = await client.exec({
      query: 'SELECT plus({val1: Int32}, {val2: Int32})',
      query_params: {
        val1: 10,
        val2: 20,
      },
    })
    expect(await getAsText(result.stream)).toEqual('30\n')
  })

  describe('trailing semi', () => {
    it('should allow commands with semi in select clause', async () => {
      const result = await client.exec({
        query: `SELECT ';' FORMAT CSV`,
      })
      expect(await getAsText(result.stream)).toEqual('";"\n')
    })

    it('should allow commands with trailing semi', async () => {
      const result = await client.exec({
        query: 'EXISTS system.databases;',
      })
      expect(await getAsText(result.stream)).toEqual('1\n')
    })

    it('should allow commands with multiple trailing semi', async () => {
      const result = await client.exec({
        query: 'EXISTS system.foobar;;;;;;',
      })
      expect(await getAsText(result.stream)).toEqual('0\n')
    })

    it('should work with default_format', async () => {
      const format = 'JSONEachRow'
      const { stream, query_id } = await client.exec({
        query: 'SELECT number FROM system.numbers LIMIT 1',
        clickhouse_settings: {
          default_format: format,
        },
      })
      const rs = new ResultSet(stream, format, query_id)
      expect(await rs.json()).toEqual([{ number: '0' }])
    })
  })
})
