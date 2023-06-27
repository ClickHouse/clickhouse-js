export interface RetryStrategy {
  shouldRetry(retries_count: number): boolean
  waitForRetry?(): Promise<void>
}

/**
 * Default strategy for the client. Never retries the requests.
 */
export const NoRetryStrategy: RetryStrategy = {
  shouldRetry() {
    return false
  },
  async waitForRetry(): Promise<void> {
    return undefined
  },
}

/**
 * Simple strategy to immediately retry a failed request
 * until we exceed {@link max_retries} number of requests.
 */
export class SimpleRetryStrategy implements RetryStrategy {
  private readonly max_retries: number
  constructor(max_retries: number) {
    if (max_retries < 1) {
      throw new Error('Max retries should be at least one')
    }
    this.max_retries = max_retries
  }
  shouldRetry(retries_count: number): boolean {
    return retries_count < this.max_retries
  }
}
