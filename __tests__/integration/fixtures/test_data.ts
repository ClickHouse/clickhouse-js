import type { ClickHouseClient } from '../../../src'

export const jsonValues = [
  { id: '42', name: 'hello', sku: [0, 1] },
  { id: '43', name: 'world', sku: [2, 3] },
  { id: '44', name: 'foo', sku: [3, 4] },
  { id: '45', name: 'bar', sku: [4, 5] },
  { id: '46', name: 'baz', sku: [6, 7] },
]

export async function assertJsonValues(
  client: ClickHouseClient,
  tableName: string
) {
  const result = await client
    .query({
      query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
      format: 'JSONEachRow',
    })
    .then((r) => r.json())
  expect(result).toEqual(jsonValues)
}
