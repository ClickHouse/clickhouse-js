import type { Row } from '../../src'
import { Rows } from '../../src'
import { Readable } from 'stream'

describe('rows', () => {
  const row1 = '{"foo":"bar"}\n'
  const row2 = '{"qaz":"qux"}\n'
  const expectedText = `{"foo":"bar"}\n{"qaz":"qux"}\n`
  const expectedJson = [{ foo: 'bar' }, { qaz: 'qux' }]

  const err = 'Stream has been already consumed'

  it('should consume the response as text, then as JSON', async () => {
    const rows = makeRows()

    expect(await rows.text()).toEqual(expectedText)
    await expect(rows.text()).rejects.toThrowError(err)
    await expect(rows.json()).rejects.toThrowError(err)
  })

  it('should consume the response as JSON, then as text', async () => {
    const rows = makeRows()

    expect(await rows.json()).toEqual(expectedJson)
    await expect(rows.json()).rejects.toThrowError(err)
    await expect(rows.text()).rejects.toThrowError(err)
  })

  it('should consume the response as an arbitrary stream', async () => {
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

  function makeRows() {
    return new Rows(
      Readable.from([Buffer.from(row1), Buffer.from(row2)]),
      'JSONEachRow'
    )
  }
})
