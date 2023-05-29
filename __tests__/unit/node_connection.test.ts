import { createConnection } from 'client-node/src'
import { NodeHttpConnection } from 'client-node/src/node_http_connection'
import { NodeHttpsConnection } from 'client-node/src/node_https_connection'

describe('Node.js connection', () => {
  it('should create HTTP adapter', async () => {
    const adapter = createConnection({
      url: new URL('http://localhost'),
    } as any)
    expect(adapter).toBeInstanceOf(NodeHttpConnection)
  })

  it('should create HTTPS adapter', async () => {
    const adapter = createConnection({
      url: new URL('https://localhost'),
    } as any)
    expect(adapter).toBeInstanceOf(NodeHttpsConnection)
  })

  it('should throw if the supplied protocol is unknown', async () => {
    expect(() =>
      createConnection({
        url: new URL('tcp://localhost'),
      } as any)
    ).toThrowError('Only HTTP(s) adapters are supported')
  })
})
