import type { TestEnv } from './test_env'
import { getClickHouseTestEnvironment } from './test_env'

export const whenOnEnv = (...envs: Array<TestEnv>) => {
  const currentEnv = getClickHouseTestEnvironment()
  return {
    it: (...args: Parameters<typeof it>) =>
      envs.includes(currentEnv)
        ? it(...args)
        : logItAndSkip(currentEnv, ...args),
    fit: (...args: Parameters<typeof it>) =>
      envs.includes(currentEnv)
        ? fit(...args)
        : logItAndSkip(currentEnv, ...args),
    describe: (...args: Parameters<typeof describe>) =>
      envs.includes(currentEnv)
        ? describe(...args)
        : logDescribeAndSkip(currentEnv, ...args),
    fdescribe: (...args: Parameters<typeof describe>) =>
      envs.includes(currentEnv)
        ? fdescribe(...args)
        : logDescribeAndSkip(currentEnv, ...args),
  }
}

function logItAndSkip(currentEnv: TestEnv, ...args: Parameters<typeof it>) {
  console.info(`Test "${args[0]}" is skipped for ${currentEnv} environment`)
  return xit(...args)
}

function logDescribeAndSkip(
  currentEnv: TestEnv,
  ...args: Parameters<typeof describe>
) {
  console.info(`Suite "${args[0]}" is skipped for ${currentEnv} environment`)
  return xdescribe(...args)
}
