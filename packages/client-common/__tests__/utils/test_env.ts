export enum TestEnv {
  Cloud = 'cloud',
  CloudSMT = 'cloud_smt',
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
    case 'cloud_smt':
      env = TestEnv.CloudSMT
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
          'Possible options: `local_single_node`, `local_cluster`, `cloud`, `cloud_smt`. ' +
          'You can keep it unset to fall back to `local_single_node`',
      )
  }
  return env
}

export function isCloudTestEnv(): boolean {
  const env = getClickHouseTestEnvironment()
  return env === TestEnv.Cloud || env === TestEnv.CloudSMT
}
