import type { ConnQueryResult } from '@clickhouse/client-common'
import { validateUUID } from '@test/utils'
import type Stream from 'stream'
import { getAsText } from '../../src/utils'

export async function assertConnQueryResult(
  { stream, query_id }: ConnQueryResult<Stream.Readable>,
  expectedResponseBody: any
) {
  const { text } = await getAsText(stream)
  expect(text).toBe(expectedResponseBody)
  assertQueryId(query_id)
}

export function assertQueryId(query_id: string) {
  expect(typeof query_id).toBe('string')
  expect(validateUUID(query_id)).toBeTruthy()
}
