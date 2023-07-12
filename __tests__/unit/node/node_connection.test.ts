import { createConnection } from '@clickhouse/client'
import type { NodeConnectionParams } from '@clickhouse/client/connection'
import {
  NodeHttpConnection,
  NodeHttpsConnection,
} from '@clickhouse/client/connection'

describe('Node.js connection', () => {
  const baseParams = {
    keep_alive: {
      enabled: true,
      retry_on_expired_socket: false,
      socket_ttl: 2500,
    },
  } as NodeConnectionParams

  it('should create HTTP adapter', async () => {
    expect(adapter).toBeInstanceOf(NodeHttpConnection)
  })
  const adapter = createConnection({
    ...baseParams,
    url: new URL('http://localhost'),
  })

  it('should create HTTPS adapter', async () => {
    const adapter = createConnection({
      ...baseParams,
      url: new URL('https://localhost'),
    })
    expect(adapter).toBeInstanceOf(NodeHttpsConnection)
  })

  it('should throw if the supplied protocol is unknown', async () => {
    expect(() =>
      createConnection({
        ...baseParams,
        url: new URL('tcp://localhost'),
      })
    ).toThrowError('Only HTTP(s) adapters are supported')
  })
})
