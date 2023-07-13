import type { Row } from '@clickhouse/client-common'
import { type ClickHouseClient } from '@clickhouse/client-common'
import { createSimpleTable } from '@test/fixtures/simple_table'
import { createTestClient, guid } from '@test/utils'

// TODO: This is complicated cause outgoing request with ReadableStream body support is limited
//  FF does not support streaming for inserts: https://bugzilla.mozilla.org/show_bug.cgi?id=1387483
//  Chrome "failed to fetch" despite following https://developer.chrome.com/articles/fetch-streaming-requests/
xdescribe('Browser streaming e2e', () => {
  let tableName: string
  let client: ClickHouseClient<ReadableStream>
  beforeEach(async () => {
    client = createTestClient()

    tableName = `browser_streaming_e2e_test_${guid()}`
    await createSimpleTable(client, tableName)
  })

  afterEach(async () => {
    await client.close()
  })

  const expected: Array<Array<string | number[]>> = [
    ['0', 'a', [1, 2]],
    ['1', 'b', [3, 4]],
    ['2', 'c', [5, 6]],
  ]

  it('should stream a stream created in-place', async () => {
    await client.insert({
      table: tableName,
      values: new ReadableStream({
        start(controller) {
          expected.forEach((item) => {
            controller.enqueue(item)
          })
          controller.close()
        },
      }),
      format: 'JSONCompactEachRow',
    })

    const rs = await client.query({
      query: `SELECT * from ${tableName}`,
      format: 'JSONCompactEachRow',
    })

    const actual: unknown[] = []

    const reader = rs.stream().getReader()
    let isDone = false
    while (!isDone) {
      const { done, value: rows } = await reader.read()
      ;(rows as Row[]).forEach((row: Row) => {
        actual.push(row.json())
      })
      isDone = done
    }

    expect(actual).toEqual(expected)
  })
})
