import { createTestClient, sleep } from '../utils'

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

describe('client', () => {
  it('closes the client when used with using statement', async () => {
    if (!isAwaitUsingStatementSupported()) {
      pending('using statement is not supported in this environment')
      return
    }
    const client = createTestClient()
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
