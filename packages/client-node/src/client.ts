import type { DataFormat } from '@clickhouse/client-common'
import { ClickHouseClient } from '@clickhouse/client-common'
import { NodeHttpConnection } from './node_http_connection'
import { NodeHttpsConnection } from './node_https_connection'
import type {
  Connection,
  ConnectionParams,
} from '@clickhouse/client-common/connection'
import type Stream from 'stream'
import { ResultSet } from './result_set'
import { NodeValuesEncoder } from './encode'
import type { BaseClickHouseClientConfigOptions } from '@clickhouse/client-common/client'
import type { TLSParams } from './node_base_connection'

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
    makeConnection: (config) => {
      switch (config.url.protocol) {
        case 'http:':
          return new NodeHttpConnection(config)
        case 'https:':
          return new NodeHttpsConnection({ ...config, tls })
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
