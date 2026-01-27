import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import {
  getTestConnectionType,
  TestConnectionType,
} from '../../../client-common/__tests__/utils/test_connection_type'
import {
  getClickHouseTestEnvironment,
  TestEnv,
} from '../../../client-common/__tests__/utils/test_env'

/** Ideally, should've been in common, but it does not work with Karma well */
describe('Test env variables parsing', () => {
  describe('CLICKHOUSE_TEST_ENVIRONMENT', () => {
    const key = 'CLICKHOUSE_TEST_ENVIRONMENT'
    addHooks(key)

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

  describe('CLICKHOUSE_TEST_CONNECTION_TYPE', () => {
    const key = 'CLICKHOUSE_TEST_CONNECTION_TYPE'
    addHooks(key)

    it('should fall back to Node.js if unset', async () => {
      expect(getTestConnectionType()).toBe(TestConnectionType.Node)
    })

    it('should be able to set Node.js explicitly', async () => {
      process.env[key] = 'node'
      expect(getTestConnectionType()).toBe(TestConnectionType.Node)
    })

    it('should be able to set Browser explicitly', async () => {
      process.env[key] = 'browser'
      expect(getTestConnectionType()).toBe(TestConnectionType.Browser)
    })

    it('should throw in case of an empty string', async () => {
      process.env[key] = ''
      expect(getTestConnectionType).toThrowError()
    })

    it('should throw in case of malformed enum value', async () => {
      process.env[key] = 'foobar'
      expect(getTestConnectionType).toThrowError()
    })
  })

  function addHooks(key: string) {
    let previousValue = process.env[key]
    beforeAll(() => {
      previousValue = process.env[key]
    })
    beforeEach(() => {
      Reflect.deleteProperty(process.env, key)
    })
    afterAll(() => {
      process.env[key] = previousValue
    })
  }
})
