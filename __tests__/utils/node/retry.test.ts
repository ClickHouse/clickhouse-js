import { retryOnFailure, type RetryOnFailureOptions } from '../retry'

// FIXME: expect does not throw on Jasmine;
//  figure out another way to retry expect failures
xdescribe('retryOnFailure', () => {
  it('should resolve after some failures', async () => {
    let result = 0
    setTimeout(() => {
      result = 42
    }, 100)
    await retryOnFailure(async () => {
      expect(result).toEqual(42)
    })
  })

  it('should throw after final fail', async () => {
    let result = 0
    setTimeout(() => {
      result = 42
    }, 1000).unref()
    await expectAsync(
      retryOnFailure(
        async () => {
          expect(result).toEqual(42)
        },
        {
          maxAttempts: 2,
          waitBetweenAttemptsMs: 1,
        }
      )
    ).toBeRejectedWithError()
  })

  it('should not allow invalid options values', async () => {
    const assertThrows = async (options: RetryOnFailureOptions) => {
      await expectAsync(
        retryOnFailure(async () => {
          expect(1).toEqual(1)
        }, options)
      ).toBeRejectedWithError()
    }

    for (const [maxAttempts, waitBetweenAttempts] of [
      [-1, 1],
      [1, -1],
      [0, 1],
      [1, 0],
    ]) {
      await assertThrows({
        maxAttempts,
        waitBetweenAttemptsMs: waitBetweenAttempts,
      })
    }
  })
})
