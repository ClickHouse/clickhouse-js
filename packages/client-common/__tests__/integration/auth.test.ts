import { type ClickHouseClient } from '@clickhouse/client-common'
import { createSimpleTable } from '@test/fixtures/simple_table'
import { getAuthFromEnv } from '@test/utils/env'
import { createTestClient, guid } from '../utils'

describe('authentication', () => {
  let invalidAuthClient: ClickHouseClient
  beforeEach(() => {
    invalidAuthClient = createTestClient({
      username: 'gibberish',
      password: 'gibberish',
    })
  })
  afterEach(async () => {
    await invalidAuthClient.close()
  })

  it('provides authentication error details', async () => {
    await expectAsync(
      invalidAuthClient.query({
        query: 'SELECT number FROM system.numbers LIMIT 3',
      }),
    ).toBeRejectedWith(
      jasmine.objectContaining({
        code: '516',
        type: 'AUTHENTICATION_FAILED',
        message: jasmine.stringMatching('Authentication failed'),
      }),
    )
  })

  describe('request auth override', () => {
    let defaultClient: ClickHouseClient
    beforeAll(() => {
      defaultClient = createTestClient()
    })
    afterAll(async () => {
      await defaultClient.close()
    })

    let tableName: string
    const values = [
      {
        id: '1',
        name: 'foo',
        sku: [3, 4],
      },
    ]
    const auth = getAuthFromEnv()

    it('should with with insert and select', async () => {
      tableName = `simple_table_${guid()}`
      await createSimpleTable(defaultClient, tableName)
      await invalidAuthClient.insert({
        table: tableName,
        format: 'JSONEachRow',
        values,
        auth,
      })
      const rs = await invalidAuthClient.query({
        query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
        format: 'JSONEachRow',
        auth,
      })
      expect(await rs.json()).toEqual(values)
    })

    it('should work with command and select', async () => {
      tableName = `simple_table_${guid()}`
      await createSimpleTable(defaultClient, tableName)
      await invalidAuthClient.command({
        query: `INSERT INTO ${tableName} VALUES (1, 'foo', [3, 4])`,
        auth,
      })
      const rs = await invalidAuthClient.query({
        query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
        format: 'JSONEachRow',
        auth,
      })
      expect(await rs.json()).toEqual(values)
    })

    it('should work with exec', async () => {
      const { stream } = await invalidAuthClient.exec({
        query: 'SELECT 42, 144 FORMAT CSV',
        auth,
      })
      let result = ''
      const textDecoder = new TextDecoder()
      // @ts-expect-error - ReadableStream (Web) or Stream.Readable (Node.js); same API.
      for await (const chunk of stream) {
        result += textDecoder.decode(chunk, { stream: true })
      }
      expect(result).toEqual('42,144\n')
    })
  })
})
