import { createConnection } from '@clickhouse/client'
import {
  NodeHttpConnection,
  NodeHttpsConnection,
} from '@clickhouse/client/connection'

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
