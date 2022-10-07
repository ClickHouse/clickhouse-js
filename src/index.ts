import { createClient } from './client'

export { createClient }
export default {
  createClient,
}

export {
  type ClickHouseClientConfigOptions,
  type ClickHouseClient,
  type BaseParams,
  type QueryParams,
  type ExecParams,
  type InsertParams,
} from './client'

export { Row, ResultSet } from './result'
export type { Connection } from './connection'
export type { DataFormat } from './data_formatter'
export type { ClickHouseError } from './error'
export type { Logger } from './logger'

export type {
  ResponseJSON,
  InputJSON,
  InputJSONObjectEachRow,
} from './clickhouse_types'
export type { ClickHouseSettings } from './settings'
export { SettingsMap } from './settings'
