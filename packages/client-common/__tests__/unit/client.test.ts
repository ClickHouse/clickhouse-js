import { vi, describe, it, expect } from 'vitest'
import { sleep } from '../utils/sleep'
import { ClickHouseClient } from '../../src/client'

function isAwaitUsingStatementSupported(): boolean {
  try {
    eval(`
      (async () => {
          await using c = null;
      })
    `)
    return true
  } catch {
    return false
  }
}

function mockImpl(): any {
  return {
    make_connection: () => {
      return {} as any
    },
    values_encoder: () => {
      return {} as any
    },
  }
}

describe('client.query FORMAT clause handling', () => {
  function makeClientCapturingQuery(): {
    client: ClickHouseClient
    getLastQuery: () => string
    getLastFormat: () => string
  } {
    let lastQuery = ''
    let lastFormat = ''
    const client = new ClickHouseClient({
      url: 'http://localhost',
      impl: {
        make_connection: () =>
          ({
            query: async (params: { query: string }) => {
              lastQuery = params.query
              return {
                stream: {} as any,
                query_id: 'q',
                response_headers: {},
              }
            },
          }) as any,
        make_result_set: ((stream: any, format: any, query_id: string) => {
          lastFormat = format
          return {
            stream,
            query_id,
          }
        }) as any,
        values_encoder: () => ({}) as any,
      } as any,
    })
    return {
      client,
      getLastQuery: () => lastQuery,
      getLastFormat: () => lastFormat,
    }
  }

  it('appends FORMAT when the query has no FORMAT clause', async () => {
    const { client, getLastQuery } = makeClientCapturingQuery()
    await client.query({ query: 'SELECT 1', format: 'JSON' })
    expect(getLastQuery()).toBe('SELECT 1 \nFORMAT JSON')
  })

  it('appends the default FORMAT (JSON) when format is omitted', async () => {
    const { client, getLastQuery } = makeClientCapturingQuery()
    await client.query({ query: 'SELECT 1' })
    expect(getLastQuery()).toBe('SELECT 1 \nFORMAT JSON')
  })

  it('does not append a second FORMAT when one is already present', async () => {
    const { client, getLastQuery, getLastFormat } = makeClientCapturingQuery()
    await client.query({ query: 'SELECT 1 FORMAT CSV', format: 'CSV' })
    expect(getLastQuery()).toBe('SELECT 1 FORMAT CSV')
    expect(getLastFormat()).toBe('CSV')
  })

  it('detects an existing FORMAT clause case-insensitively and with newlines', async () => {
    const { client, getLastQuery, getLastFormat } = makeClientCapturingQuery()
    await client.query({
      query: 'SELECT 1\nformat JSONEachRow',
      format: 'JSONEachRow',
    })
    expect(getLastQuery()).toBe('SELECT 1\nformat JSONEachRow')
    expect(getLastFormat()).toBe('JSONEachRow')
  })

  it('infers result format from trailing FORMAT clause when format is omitted', async () => {
    const { client, getLastFormat } = makeClientCapturingQuery()
    await client.query({ query: 'SELECT 1 format jsonEachRow' })
    expect(getLastFormat()).toBe('JSONEachRow')
  })

  it('infers result format when query ends with FORMAT and format on next line', async () => {
    const { client, getLastQuery, getLastFormat } = makeClientCapturingQuery()
    await client.query({ query: 'SELECT 1 FORMAT\nJSONEachRow' })
    expect(getLastQuery()).toBe('SELECT 1 FORMAT\nJSONEachRow')
    expect(getLastFormat()).toBe('JSONEachRow')
  })

  it('throws when query FORMAT does not match the provided format', async () => {
    const { client } = makeClientCapturingQuery()
    await expect(
      client.query({ query: 'SELECT 1 FORMAT CSV', format: 'JSON' }),
    ).rejects.toThrow(
      'Query FORMAT (CSV) must match QueryParams.format (JSON), or omit QueryParams.format.',
    )
  })

  it('strips a trailing semicolon before appending FORMAT', async () => {
    const { client, getLastQuery } = makeClientCapturingQuery()
    await client.query({ query: 'SELECT 1;', format: 'JSON' })
    expect(getLastQuery()).toBe('SELECT 1 \nFORMAT JSON')
  })

  it('still appends FORMAT when "format" only appears as an identifier', async () => {
    const { client, getLastQuery } = makeClientCapturingQuery()
    await client.query({ query: 'SELECT format FROM t', format: 'JSON' })
    expect(getLastQuery()).toBe('SELECT format FROM t \nFORMAT JSON')
  })

  it('still appends FORMAT when query ends with "format" identifier', async () => {
    const { client, getLastQuery } = makeClientCapturingQuery()
    await client.query({ query: 'SELECT * FROM format', format: 'JSON' })
    expect(getLastQuery()).toBe('SELECT * FROM format \nFORMAT JSON')
  })
})

describe('client', () => {
  it.skipIf(!isAwaitUsingStatementSupported())(
    'closes the client when used with using statement',
    async () => {
      const client = new ClickHouseClient({
        url: 'http://localhost',
        impl: mockImpl(),
      })
      let isClosed = false
      vi.spyOn(client, 'close').mockImplementation(async () => {
        // Simulate some delay in closing
        await sleep(0)
        isClosed = true
      })

      // Wrap in eval to allow using statement syntax without
      // syntax error in older Node.js versions. Might want to
      // consider using a separate test file for this in the future.
      await eval(`
      (async (value) => {
          await using c = value;
          // do nothing, just testing the disposal at the end of the block
      })
    `)(client)

      expect(isClosed).toBeTruthy()
    },
  )
})
