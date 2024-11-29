import type { ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient } from '@test/utils'

// See https://github.com/ClickHouse/clickhouse-js/issues/106
describe('invalid string length', () => {
  let client: ClickHouseClient
  afterEach(async () => {
    await client.close()
  })
  beforeEach(async () => {
    client = createTestClient()
  })

  const errorMessageMatcher = jasmine.stringContaining(
    'consider limiting the amount of requested rows',
  )

  // The client will buffer the entire response in a string for non-streamable formats.
  // A large amount of system.numbers selected should overflow the max allowed allocation size for a string.
  it('should fail with a specific error when the response string is too large - json() call', async () => {
    const rs = await client.query({
      query: 'SELECT number FROM numbers(50000000)',
      format: 'JSON',
    })
    await expectAsync(rs.json()).toBeRejectedWith(
      jasmine.objectContaining({
        message: errorMessageMatcher,
      }),
    )
    expect().nothing()
  })

  it('should fail with a specific error when the response string is too large - text() call', async () => {
    const rs = await client.query({
      query: 'SELECT number FROM numbers(50000000)',
      format: 'JSON',
    })
    await expectAsync(rs.text()).toBeRejectedWith(
      jasmine.objectContaining({
        message: errorMessageMatcher,
      }),
    )
    expect().nothing()
  })
})
