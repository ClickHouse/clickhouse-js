import { toSearchParams } from '../../src/connection/adapter/http_search_params'
import type { URLSearchParams } from 'url'

describe('toSearchParams', () => {
  it('should return undefined with default settings', async () => {
    expect(toSearchParams({ database: 'default' })).toBeUndefined()
  })

  it('should set database', async () => {
    const params = toSearchParams({ database: 'mydb' })!
    expect([...params.entries()]).toEqual([['database', 'mydb']])
  })

  it('should set ClickHouse settings', async () => {
    const params = toSearchParams({
      database: 'default',
      clickhouse_settings: {
        insert_quorum: '2',
        distributed_product_mode: 'global',
        limit: '42',
        allow_nondeterministic_mutations: undefined, // will be omitted
      },
    })!
    expect(toSortedArray(params)).toEqual([
      ['distributed_product_mode', 'global'],
      ['insert_quorum', '2'],
      ['limit', '42'],
    ])
  })

  it('should set query params', async () => {
    const params = toSearchParams({
      database: 'default',
      query_params: {
        foo: 42,
        bar: true,
        qaz: 'qux',
      },
    })!
    expect(toSortedArray(params)).toEqual([
      ['param_bar', '1'],
      ['param_foo', '42'],
      ['param_qaz', 'qux'],
    ])
  })

  it('should set query', async () => {
    const query = 'SELECT * FROM system.settings'
    const params = toSearchParams({
      database: 'default',
      query,
    })!
    expect(toSortedArray(params)).toEqual([['query', query]])
  })

  it('should set everything', async () => {
    const query = 'SELECT * FROM system.query_log'
    const params = toSearchParams({
      database: 'some_db',
      clickhouse_settings: {
        extremes: 1,
        enable_optimize_predicate_expression: 0,
        wait_end_of_query: 1,
      },
      query_params: {
        qaz: 'qux',
      },
      session_id: 'my-session-id',
      query_id: 'my-query-id',
      query,
    })!
    const result = toSortedArray(params)
    expect(result).toEqual([
      ['database', 'some_db'],
      ['enable_optimize_predicate_expression', '0'],
      ['extremes', '1'],
      ['param_qaz', 'qux'],
      ['query', 'SELECT * FROM system.query_log'],
      ['query_id', 'my-query-id'],
      ['session_id', 'my-session-id'],
      ['wait_end_of_query', '1'],
    ])
  })
})

function toSortedArray(params: URLSearchParams): [string, string][] {
  return [...params.entries()].sort(([key1], [key2]) =>
    String(key1).localeCompare(String(key2))
  )
}
