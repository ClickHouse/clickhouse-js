import type { ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient, guid } from '../../utils'
import { createSimpleTable } from '../fixtures/simple_table'
import Stream from 'stream'

describe('insert', () => {
  let client: ClickHouseClient
  let tableName: string

  beforeEach(async () => {
    client = await createTestClient()
    tableName = `insert_test_${guid()}`
    await createSimpleTable(client, tableName)
  })
  afterEach(async () => {
    await client.close()
  })
  it('should provide error details about a dataset with an invalid type', async () => {
    await expectAsync(
      client.insert({
        table: tableName,
        values: Stream.Readable.from(['42,foobar,"[1,2]"'], {
          objectMode: false,
        }),
        format: 'TabSeparated',
      })
    ).toBeRejectedWith(
      jasmine.objectContaining({
        message: jasmine.stringContaining('Cannot parse input'),
        code: '27',
        type: 'CANNOT_PARSE_INPUT_ASSERTION_FAILED',
      })
    )
  })
})
