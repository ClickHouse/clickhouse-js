import { createConnection } from '../../src/connection'
import { HttpAdapter, HttpsAdapter } from '../../src/connection/adapter'

describe('connection', () => {
  it('should create HTTP adapter', async () => {
    const adapter = createConnection(
      {
        url: new URL('http://localhost'),
      } as any,
      {} as any
    )
    expect(adapter).toBeInstanceOf(HttpAdapter)
  })

  it('should create HTTPS adapter', async () => {
    const adapter = createConnection(
      {
        url: new URL('https://localhost'),
      } as any,
      {} as any
    )
    expect(adapter).toBeInstanceOf(HttpsAdapter)
  })

  it('should throw if the supplied protocol is unknown', async () => {
    expect(() =>
      createConnection(
        {
          url: new URL('tcp://localhost'),
        } as any,
        {} as any
      )
    ).toThrowError('Only HTTP(s) adapters are supported')
  })
})
