import { it, beforeEach, afterEach } from 'vitest'
import {
  assertError,
  streamErrorQueryParams,
} from '@test/fixtures/stream_errors'
import { isClickHouseVersionAtLeast } from '@test/utils/server_version'
import type { ClickHouseClient } from '../../src'
import type { ClickHouseError } from '../../src'
import { createNodeTestClient } from '../utils/node_client'

// See https://github.com/ClickHouse/ClickHouse/pull/88818
let client: ClickHouseClient

beforeEach(async () => {
  client = createNodeTestClient()
})
afterEach(async () => {
  await client.close()
})

it('[Node.js] Stream error handling - with async iterators', async ({
  skip,
}) => {
  if (!isClickHouseVersionAtLeast(25, 11)) {
    skip()
  }

  let caughtError: ClickHouseError | null = null

  try {
    const queryParams = streamErrorQueryParams()
    const rs = await client.query(queryParams)

    const stream = rs.stream()
    for await (const rows of stream) {
      for (const row of rows) {
        row.json() // ignored
      }
    }
  } catch (err) {
    caughtError = err as ClickHouseError
  }

  assertError(caughtError)
})
