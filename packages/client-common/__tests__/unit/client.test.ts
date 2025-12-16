import { ClickHouseClient } from '../../src/client'

const MAJOR_NODE_VERSION = Number(process.version.split('.', 1)[0].substring(1))

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('client', () => {
  it('closes the client when used with using statement', async () => {
    if (MAJOR_NODE_VERSION < 24) {
      pending('using statement is only supported in Node.js v24 and above')
      return
    }
    const client = new ClickHouseClient({
      url: 'http://localhost',
      impl: mockImpl(),
    })
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
          // do nothing, just testing the disposal
      })
    `)(client)

    expect(isClosed).toBeTrue()
  })
})
