export { createClient } from './client'
export { ResultSet } from './result_set'

/** Re-export @clickhouse/client-common types */
export {
  type ClickHouseClientConfigOptions,
  type BaseQueryParams,
  type QueryParams,
  type ExecParams,
  type InsertParams,
  type InsertValues,
  type ValuesEncoder,
  type MakeResultSet,
  type MakeConnection,
  ClickHouseClient,
  type CommandParams,
  type CommandResult,
  Row,
  IResultSet,
  Connection,
  InsertResult,
  DataFormat,
  ClickHouseError,
  Logger,
  ResponseJSON,
  InputJSON,
  InputJSONObjectEachRow,
  type ClickHouseSettings,
  SettingsMap,
} from '@clickhouse/client-common'
