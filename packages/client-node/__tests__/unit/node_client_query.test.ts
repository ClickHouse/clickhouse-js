import { describe, it, expect, beforeEach, vi } from 'vitest'
import Http from 'http'
import { NodeClickHouseClient } from '../../src/client'
import { NodeConfigImpl } from '../../src/config'
import { emitResponseBody, stubClientRequest } from '../utils/http_stubs'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('[Node.js] NodeClickHouseClient query method', () => {
  it('should call query method and return ResultSet', async () => {
    // Create a client instance using the internal constructor
    const client = new NodeClickHouseClient({
      impl: NodeConfigImpl,
      url: 'http://localhost:8123',
    })

    // Mock the underlying HTTP request
    const httpRequestStub = vi.spyOn(Http, 'request')
    const request = stubClientRequest()
    httpRequestStub.mockReturnValue(request)

    // Start a query
    const queryPromise = client.query({
      query: 'SELECT number FROM system.numbers LIMIT 3',
      format: 'JSONEachRow',
    })

    // Emit a response
    const responseBody = JSON.stringify({ number: '0' }) + '\n'
    await emitResponseBody(request, responseBody)

    // Wait for the query to complete
    const result = await queryPromise

    // Verify the result is a ResultSet
    expect(result).toBeDefined()
    expect(result.query_id).toBeDefined()
    expect(typeof result.query_id).toBe('string')

    // Verify the stream can be consumed
    const text = await result.text()
    expect(text).toMatchInlineSnapshot(`
      "{"number":"0"}
      "
    `)

    // Close the client
    await client.close()
  })

  it('should handle query with different format parameter', async () => {
    const client = new NodeClickHouseClient({
      impl: NodeConfigImpl,
      url: 'http://localhost:8123',
    })

    const httpRequestStub = vi.spyOn(Http, 'request')
    const request = stubClientRequest()
    httpRequestStub.mockReturnValue(request)

    const queryPromise = client.query({
      query: 'SELECT 1',
      format: 'CSV',
    })

    const responseBody = '1\n'
    await emitResponseBody(request, responseBody)

    const result = await queryPromise
    expect(result).toBeDefined()

    const text = await result.text()
    expect(text).toMatchInlineSnapshot(`"1\n"`)

    await client.close()
  })

  it('should maintain type safety with query format', async () => {
    const client = new NodeClickHouseClient({
      impl: NodeConfigImpl,
      url: 'http://localhost:8123',
    })

    const httpRequestStub = vi.spyOn(Http, 'request')
    const request = stubClientRequest()
    httpRequestStub.mockReturnValue(request)

    // Test with JSON format (default)
    const queryPromise = client.query({
      query: 'SELECT 42 as answer',
      format: 'JSON',
    })

    const responseBody = JSON.stringify({
      meta: [{ name: 'answer', type: 'UInt8' }],
      data: [{ answer: 42 }],
      rows: 1,
      statistics: {
        elapsed: 0.001,
        rows_read: 1,
        bytes_read: 1,
      },
    })
    await emitResponseBody(request, responseBody)

    const result = await queryPromise
    expect(result).toBeDefined()

    // Verify we can get JSON response
    const json = await result.json()
    expect(json).toMatchInlineSnapshot(`
      {
        "data": [
          {
            "answer": 42,
          },
        ],
        "meta": [
          {
            "name": "answer",
            "type": "UInt8",
          },
        ],
        "rows": 1,
        "statistics": {
          "bytes_read": 1,
          "elapsed": 0.001,
          "rows_read": 1,
        },
      }
    `)

    await client.close()
  })
})
