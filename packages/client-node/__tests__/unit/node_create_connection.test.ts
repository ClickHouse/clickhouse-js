import type { ConnectionParams } from '@clickhouse/client-common'
import {
  createConnection,
  type NodeConnectionParams,
  NodeHttpConnection,
  NodeHttpsConnection,
} from '../../src/connection'

describe('[Node.js] createConnection', () => {
  const keepAliveParams: NodeConnectionParams['keep_alive'] = {
    enabled: true,
    idle_socket_ttl: 2500,
  }
  const tlsParams: NodeConnectionParams['tls'] = undefined

  it('should create an instance of HTTP adapter', async () => {
    expect(adapter).toBeInstanceOf(NodeHttpConnection)
  })
  const adapter = createConnection(
    {
      url: new URL('http://localhost'),
    } as ConnectionParams,
    tlsParams,
    keepAliveParams
  )

  it('should create an instance of HTTPS adapter', async () => {
    const adapter = createConnection(
      {
        url: new URL('https://localhost'),
      } as ConnectionParams,
      tlsParams,
      keepAliveParams
    )
    expect(adapter).toBeInstanceOf(NodeHttpsConnection)
  })

  it('should throw if the supplied protocol is unknown', async () => {
    expect(() =>
      createConnection(
        {
          url: new URL('tcp://localhost'),
        } as ConnectionParams,
        tlsParams,
        keepAliveParams
      )
    ).toThrowError('Only HTTP and HTTPS protocols are supported')
  })
})
