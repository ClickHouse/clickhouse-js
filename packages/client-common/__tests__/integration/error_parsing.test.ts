import type { ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient, getTestDatabaseName } from '../utils'

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
      }),
    ).toBeRejectedWith(
      jasmine.objectContaining({
        message: `Missing columns: 'number' while processing query: 'SELECT number AS FR', required columns: 'number'. `,
        code: '47',
        type: 'UNKNOWN_IDENTIFIER',
      }),
    )
  })

  it('returns "unknown table" error', async () => {
    // possible error messages here:
    // (since 23.8+): Table foo.unknown_table does not exist.
    // (pre-23.8):    Table foo.unknown_table doesn't exist.
    // Cloud SMT:     Unknown table expression identifier 'unknown_table' in scope
    const dbName = getTestDatabaseName()
    const errorMessagePattern =
      `((?:^Table ${dbName}.unknown_table does(n't| not) exist.*)|` +
      `(?:Unknown table expression identifier 'unknown_table' in scope))`
    await expectAsync(
      client.query({
        query: 'SELECT * FROM unknown_table',
      }),
    ).toBeRejectedWith(
      jasmine.objectContaining({
        message: jasmine.stringMatching(errorMessagePattern),
        code: '60',
        type: 'UNKNOWN_TABLE',
      }),
    )
  })

  it('returns "syntax error" error', async () => {
    await expectAsync(
      client.query({
        query: 'SELECT * FRON unknown_table',
      }),
    ).toBeRejectedWith(
      jasmine.objectContaining({
        message: jasmine.stringContaining('Syntax error: failed at position'),
        code: '62',
        type: 'SYNTAX_ERROR',
      }),
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
      }),
    ).toBeRejectedWith(
      jasmine.objectContaining({
        message: jasmine.stringContaining('Syntax error: failed at position'),
        code: '62',
        type: 'SYNTAX_ERROR',
      }),
    )
  })
})
