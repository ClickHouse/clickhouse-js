import { Readable } from 'stream'
import { createClient } from '../../src'

fdescribe('[Node.js] External data', () => {
  it('should work with external data', async () => {
    const client = createClient()
    const rs = await client.query({
      query: 'SELECT * FROM test_external',
      format: 'JSONEachRow',
      external: {
        name: 'test_external',
        format: 'CSV',
        structure: 'id UInt32, name String',
        data: makeExternalDataStream(),
      },
    })
    const data = await rs.json()
    expect(data).toEqual([
      { id: 1, name: 'foo' },
      { id: 2, name: 'bar' },
    ])
  })

  function makeExternalDataStream() {
    const stream = new Readable({
      read: () => {
        //
      },
    })
    stream.push('1,foo\n')
    stream.push('2,bar\n')
    stream.push(null)
    return stream
  }
})
