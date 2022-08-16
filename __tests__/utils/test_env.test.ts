import { getClickHouseTestEnvironment, TestEnv } from './index'

describe('TestEnv environment variable parsing', () => {
  const key = 'CLICKHOUSE_TEST_ENVIRONMENT'
  let previousValue = process.env[key]
  beforeAll(() => {
    previousValue = process.env[key]
  })
  beforeEach(() => {
    delete process.env[key]
  })
  afterAll(() => {
    process.env[key] = previousValue
  })

  it('should fall back to local_single_node env if unset', async () => {
    expect(getClickHouseTestEnvironment()).toBe(TestEnv.LocalSingleNode)
  })

  it('should be able to set local_single_node env explicitly', async () => {
    process.env[key] = 'local_single_node'
    expect(getClickHouseTestEnvironment()).toBe(TestEnv.LocalSingleNode)
  })

  it('should be able to set local_cluster env', async () => {
    process.env[key] = 'local_cluster'
    expect(getClickHouseTestEnvironment()).toBe(TestEnv.LocalCluster)
  })

  it('should be able to set cloud env', async () => {
    process.env[key] = 'cloud'
    expect(getClickHouseTestEnvironment()).toBe(TestEnv.Cloud)
  })

  it('should throw in case of an empty string', async () => {
    process.env[key] = ''
    expect(getClickHouseTestEnvironment).toThrowError()
  })

  it('should throw in case of malformed enum value', async () => {
    process.env[key] = 'foobar'
    expect(getClickHouseTestEnvironment).toThrowError()
  })
})
