import type { ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient } from '../utils'

describe('ClickHouse server errors parsing', () => {
  let client: ClickHouseClient
  beforeEach(() => {
    client = createTestClient()
  })
  afterEach(async () => {
    await client.close()
  })

  it('returns "unknown identifier" error', async () => {
    await expectAsync(
      client.query({
        query: 'SELECT number FR',
      })
    ).toBeRejectedWith(
      jasmine.objectContaining({
        message: jasmine.stringContaining(
          `Unknown expression identifier 'number' in scope SELECT number AS FR`
        ),
        code: '47',
        type: 'UNKNOWN_IDENTIFIER',
      })
    )
  })

  it('returns "unknown table" error', async () => {
    await expectAsync(
      client.query({
        query: 'SELECT * FROM unknown_table',
      })
    ).toBeRejectedWith(
      jasmine.objectContaining({
        message: jasmine.stringContaining(
          `Unknown table expression identifier 'unknown_table' in scope`
        ),
        code: '60',
        type: 'UNKNOWN_TABLE',
      })
    )
  })

  it('returns "syntax error" error', async () => {
    await expectAsync(
      client.query({
        query: 'SELECT * FRON unknown_table',
      })
    ).toBeRejectedWith(
      jasmine.objectContaining({
        message: jasmine.stringContaining('Syntax error: failed at position'),
        code: '62',
        type: 'SYNTAX_ERROR',
      })
    )
  })

  it('returns "syntax error" error in a multiline query', async () => {
    await expectAsync(
      client.query({
        query: `
        SELECT *
        /* This is:
         a multiline comment
        */
        FRON unknown_table
        `,
      })
    ).toBeRejectedWith(
      jasmine.objectContaining({
        message: jasmine.stringContaining('Syntax error: failed at position'),
        code: '62',
        type: 'SYNTAX_ERROR',
      })
    )
  })
})
