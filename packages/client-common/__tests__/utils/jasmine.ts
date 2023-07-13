import type { TestEnv } from './test_env'
import { getClickHouseTestEnvironment } from './test_env'

export const whenOnEnv = (...envs: TestEnv[]) => {
  const currentEnv = getClickHouseTestEnvironment()
  return {
    it: (...args: Parameters<typeof it>) =>
      envs.includes(currentEnv) ? it(...args) : logAndSkip(currentEnv, ...args),
  }
}

function logAndSkip(currentEnv: TestEnv, ...args: Parameters<typeof it>) {
  console.info(`Test "${args[0]}" is skipped for ${currentEnv} environment`)
  return xit(...args)
}
