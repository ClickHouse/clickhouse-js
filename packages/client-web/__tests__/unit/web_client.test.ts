import type { BaseClickHouseClientConfigOptions } from '@clickhouse/client-common'
import { createClient } from '../../src'
import { isAwaitUsingStatementSupported } from '../utils/feature_detection'
import { sleep } from '../utils/sleep'

describe('[Web] createClient', () => {
  it('throws on incorrect "url" config value', () => {
    expect(() => createClient({ url: 'foo' })).toThrow(
      jasmine.objectContaining({
        message: jasmine.stringContaining('ClickHouse URL is malformed.'),
      }),
    )
  })

  it('should not mutate provided configuration', async () => {
    const config: BaseClickHouseClientConfigOptions = {
      url: 'https://localhost:8443',
    }
    createClient(config)
    // initial configuration is not overridden by the defaults we assign
    // when we transform the specified config object to the connection params
    expect(config).toEqual({
      url: 'https://localhost:8443',
    })
  })

  it('closes the client when used with using statement', async () => {
    if (!isAwaitUsingStatementSupported()) {
      pending('using statement is not supported in this environment')
      return
    }
    const client = createClient()
    let isClosed = false
    spyOn(client, 'close').and.callFake(async () => {
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

    expect(isClosed).toBeTrue()
  })
})
