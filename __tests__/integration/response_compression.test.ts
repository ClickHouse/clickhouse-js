import { type ClickHouseClient } from '../../src'
import { createTestClient } from '../utils'
import lz4 from 'lz4-napi'

describe('response compression', () => {
  let client: ClickHouseClient
  afterEach(async () => {
    await client.close()
  })

  it('accepts a gzip compressed response', async () => {
    client = createTestClient({
      compression: {
        response: true,
        request: false,
        encoding: 'gzip',
      },
    })
    await selectAndAssert()
  })

  it('accepts an lz4 compressed response', async () => {
    client = createTestClient({
      compression: {
        response: true,
        request: false,
        encoding: 'lz4',
      },
    })
    await selectAndAssert()
  })

  async function selectAndAssert() {
    const rs = await client.query({
      query: `
        SELECT 'foobar'
      `,
      format: 'CSV',
    })

    const response = await rs.text()
    expect(response).toBe('"foobar"\n')
  }

  it('should foo', async () => {
    client = createTestClient()
    const compressed = lz4.compressSync('"foobar"\n')
    console.log(compressed)
  })
})
