import type { ClickHouseClient } from '@clickhouse/client-common'

const baseClientMethod = ['query', 'command', 'exec'] as const
interface TestParam {
  methodName: (typeof baseClientMethod)[number] | 'insert'
  methodCall: (http_headers: Record<string, string>) => Promise<unknown>
}

export function getHeadersTestParams<Stream>(
  client: Pick<ClickHouseClient<Stream>, TestParam['methodName']>,
): Array<TestParam> {
  const testParams: Array<TestParam> = baseClientMethod.map((methodName) => ({
    methodName,
    methodCall: (http_headers) =>
      client[methodName]({
        query: 'SELECT 42',
        http_headers,
      }),
  }))
  testParams.push({
    methodName: 'insert',
    methodCall: (http_headers) =>
      client.insert({
        table: 'foo',
        values: ['foo', 'bar'],
        http_headers,
      }),
  })
  return testParams
}
