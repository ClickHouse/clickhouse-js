import type { Row } from '../../src'
import { Rows } from '../../src'
import { Readable } from 'stream'

describe('rows', () => {
  const row1 = '{"foo":"bar"}\n'
  const row2 = '{"qaz":"qux"}\n'
  const expectedText = `{"foo":"bar"}\n{"qaz":"qux"}\n`
  const expectedJson = [{ foo: 'bar' }, { qaz: 'qux' }]

  it('should consume the response as text, then as JSON', async () => {
    const rows = makeRows()
    const stream = rows.asStream()

    expect(stream.readableEnded).toBeFalsy()
    expect(await rows.text()).toEqual(expectedText)
    expect(await rows.text()).toEqual(expectedText) // does not throw
    expect(rows.asStream().readableEnded).toBeTruthy()
    expect(await rows.json()).toEqual(expectedJson) // does not throw
    expect(await rows.json()).toEqual(expectedJson)
  })

  it('should consume the response as JSON, then as text', async () => {
    const rows = makeRows()
    const stream = rows.asStream()

    expect(stream.readableEnded).toBeFalsy()
    expect(await rows.json()).toEqual(expectedJson)
    expect(await rows.json()).toEqual(expectedJson) // does not throw
    expect(rows.asStream().readableEnded).toBeTruthy()
    expect(await rows.text()).toEqual(expectedText) // does not throw
    expect(await rows.text()).toEqual(expectedText)
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
    expect(rows.asStream().readableEnded).toBeTruthy()
  })

  function makeRows() {
    return new Rows(
      Readable.from([Buffer.from(row1), Buffer.from(row2)]),
      'JSONEachRow'
    )
  }
})
