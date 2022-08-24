import { Row, Rows } from '../../src'
import { Readable } from 'stream'

describe('rows', () => {
  const expectedText = `{"foo":"bar"}\n{"qaz":"qux"}\n`
  const expectedJson = [{ foo: 'bar' }, { qaz: 'qux' }]

  const err = 'Stream has been already consumed'

  it('should consume the response as text only once', async () => {
    const rows = makeRows()

    expect(await rows.text()).toEqual(expectedText)
    await expect(rows.text()).rejects.toThrowError(err)
    await expect(rows.json()).rejects.toThrowError(err)
  })

  it('should consume the response as JSON only once', async () => {
    const rows = makeRows()

    expect(await rows.json()).toEqual(expectedJson)
    await expect(rows.json()).rejects.toThrowError(err)
    await expect(rows.text()).rejects.toThrowError(err)
  })

  it('should consume the response as a stream of Row instances', async () => {
    const rows = makeRows()
    const stream = rows.asStream()

    expect(stream.readableEnded).toBeFalsy()

    const result = []
    for await (const row of stream) {
      result.push((row as Row).json())
    }

    expect(result).toEqual(expectedJson)
    expect(stream.readableEnded).toBeTruthy()

    expect(() => rows.asStream()).toThrowError(err)
    await expect(rows.json()).rejects.toThrowError(err)
    await expect(rows.text()).rejects.toThrowError(err)
  })

  it('should be able to call Row.text and Row.json multiple times', async () => {
    const chunk = '{"foo":"bar"}'
    const obj = { foo: 'bar' }
    const row = new Row(chunk, 'JSON')
    expect(row.text()).toEqual(chunk)
    expect(row.text()).toEqual(chunk)
    expect(row.json()).toEqual(obj)
    expect(row.json()).toEqual(obj)
  })

  function makeRows() {
    return new Rows(
      Readable.from([
        Buffer.from('{"foo":"bar"}\n'),
        Buffer.from('{"qaz":"qux"}\n'),
      ]),
      'JSONEachRow'
    )
  }
})
