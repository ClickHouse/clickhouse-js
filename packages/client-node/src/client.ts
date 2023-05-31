import type { DataFormat } from '@clickhouse/client-common'
import { ClickHouseClient } from '@clickhouse/client-common'
import type { TLSParams } from './connection'
import { NodeHttpConnection, NodeHttpsConnection } from './connection'
import type {
  Connection,
  ConnectionParams,
} from '@clickhouse/client-common/connection'
import type Stream from 'stream'
import { ResultSet } from './result_set'
import { NodeValuesEncoder } from './utils/encoder'
import type { BaseClickHouseClientConfigOptions } from '@clickhouse/client-common/client'

export function createConnection(
  params: ConnectionParams
): Connection<Stream.Readable> {
  // TODO throw ClickHouseClient error
  switch (params.url.protocol) {
    case 'http:':
      return new NodeHttpConnection(params)
    case 'https:':
      return new NodeHttpsConnection(params)
    default:
      throw new Error('Only HTTP(s) adapters are supported')
  }
}

export function createClient(
  config?: BaseClickHouseClientConfigOptions<Stream.Readable> & {
    tls?: BasicTLSOptions | MutualTLSOptions
  }
): ClickHouseClient<Stream.Readable> {
  let tls: TLSParams | undefined = undefined
  if (config?.tls) {
    if ('cert' in config.tls && 'key' in config.tls) {
      tls = {
        type: 'Mutual',
        ...config.tls,
      }
    } else {
      tls = {
        type: 'Basic',
        ...config.tls,
      }
    }
  }
  return new ClickHouseClient({
    makeConnection: (params: ConnectionParams) => {
      switch (params.url.protocol) {
        case 'http:':
          return new NodeHttpConnection(params)
        case 'https:':
          return new NodeHttpsConnection({ ...params, tls })
        default:
          throw new Error('Only HTTP(s) adapters are supported')
      }
    },
    makeResultSet: (
      stream: Stream.Readable,
      format: DataFormat,
      session_id: string
    ) => new ResultSet(stream, format, session_id),
    valuesEncoder: new NodeValuesEncoder(),
    ...(config || {}),
  })
}

interface BasicTLSOptions {
  ca_cert: Buffer
}

interface MutualTLSOptions {
  ca_cert: Buffer
  cert: Buffer
  key: Buffer
}
