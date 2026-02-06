import type { ClickHouseClient } from '@clickhouse/client-common'
import { createSimpleTable } from '@test/fixtures/simple_table'
import { createTestClient, guid } from '@test/utils'
import Stream from 'stream'

describe('[Node.js] insert', () => {
  let client: ClickHouseClient
  let tableName: string

  afterEach(async () => {
    await client.close()
  })

  describe('without request compression', () => {
    beforeEach(async () => {
      client = createTestClient()
      tableName = `node_insert_test_${guid()}`
      await createSimpleTable(client, tableName)
    })

    it('should provide error details about a dataset with an invalid type', async () => {
      await expectAsync(
        client.insert({
          table: tableName,
          values: Stream.Readable.from(['42,foobar,"[1,2]"'], {
            objectMode: false,
          }),
          format: 'TabSeparated',
        }),
      ).toBeRejectedWith(
        expect.objectContaining({
          message: expect.stringContaining('Cannot parse input'),
          code: '27',
          type: 'CANNOT_PARSE_INPUT_ASSERTION_FAILED',
        }),
      )
    })
  })

  describe('with request compression', () => {
    beforeEach(async () => {
      client = createTestClient({
        compression: {
          request: true,
        },
      })
      tableName = `node_insert_test_${guid()}`
      await createSimpleTable(client, tableName)
    })

    it('should not fail if the values array is empty', async () => {
      const result = await client.insert({
        table: tableName,
        values: [],
        format: 'JSONEachRow',
      })
      expect(result).toEqual({
        executed: false,
        query_id: '',
        response_headers: {},
      })
    })
  })
})
