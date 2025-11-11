import { isClickHouseVersionAtLeast } from './server_version'
import type { TestEnv } from './test_env'
import { getClickHouseTestEnvironment } from './test_env'

export const whenOnEnv = (...envs: TestEnv[]) => {
  const currentEnv = getClickHouseTestEnvironment()
  return {
    it: (...args: Parameters<typeof it>) =>
      envs.includes(currentEnv) ? it(...args) : logItAndSkip(...args),
    fit: (...args: Parameters<typeof it>) =>
      envs.includes(currentEnv) ? fit(...args) : logItAndSkip(...args),
    describe: (...args: Parameters<typeof describe>) =>
      envs.includes(currentEnv)
        ? describe(...args)
        : logDescribeAndSkip(...args),
    fdescribe: (...args: Parameters<typeof describe>) =>
      envs.includes(currentEnv)
        ? fdescribe(...args)
        : logDescribeAndSkip(...args),
  }

  function logItAndSkip(...args: Parameters<typeof it>) {
    console.info(`Test "${args[0]}" is skipped for ${currentEnv} environment`)
    return xit(...args)
  }

  function logDescribeAndSkip(...args: Parameters<typeof describe>) {
    console.info(`Suite "${args[0]}" is skipped for ${currentEnv} environment`)
    return xdescribe(...args)
  }
}

export function requireServerVersionAtLeast(major: number, minor: number) {
  if (!isClickHouseVersionAtLeast(major, minor)) {
    pending(`Required ClickHouse version is at least ${major}.${minor}`)
  }
}
