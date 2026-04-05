import { vi, describe, it, expect } from 'vitest'
import { sleep } from '../utils/sleep'
import { ClickHouseClient } from '../../src/client'
import { createSimpleTestClient } from '../utils/client'

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

describe('client', () => {
  it('createSimpleTestClient creates a client without requiring ClickHouse', () => {
    // This test verifies that createSimpleTestClient can be called without
    // connecting to a ClickHouse instance, which is important for unit tests
    const client = createSimpleTestClient()
    expect(client).toBeDefined()
    expect(client.close).toBeDefined()
    client.close()
  })

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
