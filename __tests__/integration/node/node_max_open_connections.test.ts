import { sleep } from '../../utils/retry'
import { createTestClient } from '../../utils'
import type { ClickHouseClient } from '@clickhouse/client-common'

describe('Node.js max_open_connections config', () => {
  let client: ClickHouseClient
  let results: number[] = []

  afterEach(async () => {
    await client.close()
  })

  afterEach(() => {
    results = []
  })

  function select(query: string) {
    return client
      .query({
        query,
        format: 'JSONEachRow',
      })
      .then((r) => r.json<[{ x: number }]>())
      .then(([{ x }]) => results.push(x))
  }

  it('should use only one connection', async () => {
    client = createTestClient({
      max_open_connections: 1,
    })
    void select('SELECT 1 AS x, sleep(0.3)')
    void select('SELECT 2 AS x, sleep(0.3)')
    await sleep(400)
    expect(results).toEqual([1])
    await sleep(400)
    expect(results.sort()).toEqual([1, 2])
  })

  it('should use several connections', async () => {
    client = createTestClient({
      max_open_connections: 2,
    })
    void select('SELECT 1 AS x, sleep(0.3)')
    void select('SELECT 2 AS x, sleep(0.3)')
    void select('SELECT 3 AS x, sleep(0.3)')
    void select('SELECT 4 AS x, sleep(0.3)')
    await sleep(400)
    expect(results).toContain(1)
    expect(results).toContain(2)
    expect(results.sort()).toEqual([1, 2])
    await sleep(400)
    expect(results).toContain(3)
    expect(results).toContain(4)
    expect(results.sort()).toEqual([1, 2, 3, 4])
  })
})
