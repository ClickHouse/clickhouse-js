import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  assertError,
  streamErrorQueryParams,
} from '@test/fixtures/stream_errors'
import { isClickHouseVersionAtLeast } from '@test/utils/server_version'
import type { ClickHouseClient } from '../../src'
import type { ClickHouseError } from '../../src'
import { createWebTestClient } from '../utils/web_client'

// See https://github.com/ClickHouse/ClickHouse/pull/88818
describe('[Web] Stream error handling', () => {
  let client: ClickHouseClient

  beforeEach(async () => {
    client = createWebTestClient()
  })
  afterEach(async () => {
    await client.close()
  })

  it('with reader', async ({ skip }) => {
    if (!isClickHouseVersionAtLeast(25, 11)) {
      skip()
    }

    let caughtError: ClickHouseError | null = null

    try {
      const queryParams = streamErrorQueryParams()
      const rs = await client.query(queryParams)

      const reader = rs.stream<{ n: number }>().getReader()
      while (true) {
        const { done, value: rows } = await reader.read()
        if (done) break
        for (const row of rows) {
          row.json() // ignored
        }
      }
    } catch (err) {
      caughtError = err as ClickHouseError
    }

    assertError(caughtError)
  })
})
