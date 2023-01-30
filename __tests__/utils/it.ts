import { getClickHouseTestEnvironment, TestEnv } from './test_env'

export const itSkipCloud = (...args: Parameters<jest.It>) =>
  getClickHouseTestEnvironment() !== TestEnv.Cloud
    ? it(...args)
    : logAndSkip(...args)

function logAndSkip(...args: Parameters<jest.It>) {
  console.info(`Test "${args[0]}" is skipped in the Cloud environment`)
  return it.skip(...args)
}
