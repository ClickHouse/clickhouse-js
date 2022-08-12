import { retryOnFailure } from '../utils';
import { RetryOnFailureOptions } from '../utils/retry';

describe('retryOnFailure', () => {
  it('should resolve after some failures', async () => {
    let result = 0;
    setTimeout(() => {
      result = 42;
    }, 100);
    await retryOnFailure(async () => {
      expect(result).toEqual(42);
    });
  });

  it('should throw after final fail', async () => {
    let result = 0;
    setTimeout(() => {
      result = 42;
      // @ts-expect-error. setTimeout has typings of window.setTimeout & globals.setTimeout
      // remove me when DOM lib is excluded from typings.
    }, 1000).unref();
    await expect(
      retryOnFailure(
        async () => {
          expect(result).toEqual(42);
        },
        {
          maxAttempts: 2,
          waitBetweenAttempts: 1,
        }
      )
    ).rejects.toThrowError();
  });

  it('should not allow invalid options values', async () => {
    const assertThrows = async (options: RetryOnFailureOptions) => {
      await expect(
        retryOnFailure(async () => {
          expect(1).toEqual(1);
        }, options)
      ).rejects.toThrowError();
    };

    for (const [maxAttempts, waitBetweenAttempts] of [
      [-1, 1],
      [1, -1],
      [0, 1],
      [1, 0],
    ]) {
      await assertThrows({
        maxAttempts,
        waitBetweenAttempts,
      });
    }
  });
});
