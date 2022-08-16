import { type ClickHouseClient } from '../../src'
import { createTestClient, getTestDatabaseName } from '../utils'

describe('error', () => {
  let client: ClickHouseClient
  beforeEach(() => {
    client = createTestClient()
  })
  afterEach(async () => {
    await client.close()
  })

  it('returns "unknown identifier" error', async () => {
    await expect(
      client.select({
        query: 'SELECT number FR',
      })
    ).rejects.toEqual(
      expect.objectContaining({
        message: `Missing columns: 'number' while processing query: 'SELECT number AS FR', required columns: 'number'. `,
        code: '47',
        type: 'UNKNOWN_IDENTIFIER',
      })
    )
  })

  it('returns "unknown table" error', async () => {
    await expect(
      client.select({
        query: 'SELECT * FROM unknown_table',
      })
    ).rejects.toEqual(
      expect.objectContaining({
        message: `Table ${getTestDatabaseName()}.unknown_table doesn't exist. `,
        code: '60',
        type: 'UNKNOWN_TABLE',
      })
    )
  })

  it('returns "syntax error" error', async () => {
    await expect(
      client.select({
        query: 'SELECT * FRON unknown_table',
      })
    ).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringContaining('Syntax error: failed at position'),
        code: '62',
        type: 'SYNTAX_ERROR',
      })
    )
  })

  it('returns "syntax error" error in a multiline query', async () => {
    await expect(
      client.select({
        query: `
        SELECT *
        /* This is:
         a multiline comment
        */
        FRON unknown_table
        `,
      })
    ).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringContaining('Syntax error: failed at position'),
        code: '62',
        type: 'SYNTAX_ERROR',
      })
    )
  })
})
