export enum TestEnv {
  Cloud = 'cloud',
  LocalSingleNode = 'local_single_node',
  LocalCluster = 'local_cluster',
}

export function getClickHouseTestEnvironment(): TestEnv {
  let env
  const value = process.env['CLICKHOUSE_TEST_ENVIRONMENT']
  switch (value) {
    case 'cloud':
      env = TestEnv.Cloud
      break
    case 'local_cluster':
      env = TestEnv.LocalCluster
      break
    case 'local_single_node':
    case 'undefined':
    case undefined:
      env = TestEnv.LocalSingleNode
      break
    default:
      throw new Error(
        `Unexpected CLICKHOUSE_TEST_ENVIRONMENT value: ${value}. ` +
          'Possible options: `local_single_node`, `local_cluster`, `cloud`. ' +
          'You can keep it unset to fall back to `local_single_node`',
      )
  }
  return env
}

export function isCloudTestEnv(): boolean {
  const env = getClickHouseTestEnvironment()
  return env === TestEnv.Cloud
}

export function isOnEnv(...envs: TestEnv[]): boolean {
  const env = getClickHouseTestEnvironment()
  return envs.includes(env)
}

function isEnvVarEnabled(key: string): boolean {
  return process.env[key] === '1'
}

export const SKIP_INIT = isEnvVarEnabled('CLICKHOUSE_TEST_SKIP_INIT')
export const PRINT_DDL = isEnvVarEnabled('CLICKHOUSE_TEST_PRINT_DDL')
