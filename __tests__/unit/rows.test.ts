import { Rows } from '../../src'
import { Readable } from 'stream'

describe('rows', () => {
  it('should consume the response as text', async () => {
    const rows = new Rows(
      Readable.from([
        Buffer.from('{"foo":"bar"}\n'),
        Buffer.from('{"qaz":"qux"}\n'),
      ]),
      'JSONEachRow'
    )
    const expected = `{"foo":"bar"}\n{"qaz":"qux"}\n`
    expect(await rows.text()).toEqual(expected)
    expect(await rows.text()).toEqual(expected) // does not throw
    expect(rows.asStream().readableEnded).toBeTruthy()
  })
})
