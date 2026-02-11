import { describe, it } from 'vitest'
// @ts-nocheck Re-enable after migrating to Vitest
import type { TestEnv } from './test_env'
import { getClickHouseTestEnvironment } from './test_env'

export const whenOnEnv = (...envs: TestEnv[]) => {
  const currentEnv = getClickHouseTestEnvironment()
  return {
    it: (...args: Parameters<typeof it>) =>
      envs.includes(currentEnv) ? it(...args) : logItAndSkip(...args),
    fit: (...args: Parameters<typeof it>) =>
      envs.includes(currentEnv) ? it.only(...args) : logItAndSkip(...args),
    describe: (...args: Parameters<typeof describe>) =>
      envs.includes(currentEnv)
        ? describe(...args)
        : logDescribeAndSkip(...args),
    fdescribe: (...args: Parameters<typeof describe>) =>
      envs.includes(currentEnv)
        ? describe.only(...args)
        : logDescribeAndSkip(...args),
  }

  function logItAndSkip(...args: Parameters<typeof it>) {
    console.info(`Test "${args[0]}" is skipped for ${currentEnv} environment`)
    return it.skip(...args)
  }

  function logDescribeAndSkip(...args: Parameters<typeof describe>) {
    console.info(`Suite "${args[0]}" is skipped for ${currentEnv} environment`)
    return describe.skip(...args)
  }
}
