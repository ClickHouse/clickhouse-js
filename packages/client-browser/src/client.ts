import type { BaseClickHouseClientConfigOptions } from '@clickhouse/client-common/client'
import { ClickHouseClient } from '@clickhouse/client-common/client'
import { BrowserConnection } from './connection'
import { BrowserValuesEncoder } from './utils'
import { ResultSet } from './result_set'
import type { ConnectionParams } from '@clickhouse/client-common/connection'
import type { DataFormat } from '@clickhouse/client-common'

export function createClient(
  config?: BaseClickHouseClientConfigOptions<ReadableStream>
): ClickHouseClient<ReadableStream> {
  return new ClickHouseClient<ReadableStream>({
    makeConnection: (params: ConnectionParams) => new BrowserConnection(params),
    makeResultSet: (
      stream: ReadableStream,
      format: DataFormat,
      query_id: string
    ) => new ResultSet(stream, format, query_id),
    valuesEncoder: new BrowserValuesEncoder(),
    ...(config || {}),
  })
}
