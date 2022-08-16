export enum TestEnv {
  Cloud = 'cloud',
  LocalSingleNode = 'local_single_node',
  LocalCluster = 'local_cluster',
}

export function getClickHouseTestEnvironment(): TestEnv {
  let env
  switch (process.env['CLICKHOUSE_TEST_ENVIRONMENT']) {
    case 'cloud':
      env = TestEnv.Cloud
      break
    case 'local_cluster':
      env = TestEnv.LocalCluster
      break
    case 'local_single_node':
    case undefined:
      env = TestEnv.LocalSingleNode
      break
    default:
      throw new Error(
        'Unexpected CLICKHOUSE_TEST_ENVIRONMENT value. ' +
          'Possible options: `local_single_node`, `local_cluster`, `cloud` ' +
          'or keep it unset to fall back to `local_single_node`'
      )
  }
  return env
}
