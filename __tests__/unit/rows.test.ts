import type { Row } from '../../src'
import { Rows } from '../../src'
import * as Stream from 'stream'
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
    const stream = rows.stream()

    const result = []
    for await (const row of stream) {
      result.push(row.json())
    }

    expect(result).toEqual(expectedJson)
    expect((await stream.next()).done).toBeTruthy()

    await expect(async () => {
      for await (const r of rows.stream()) {
        r.text()
      }
    }).rejects.toThrowError(err)
    await expect(rows.json()).rejects.toThrowError(err)
    await expect(rows.text()).rejects.toThrowError(err)
  })

  it('should be able to call Row.text and Row.json multiple times', async () => {
    const rows = new Rows(
      Stream.Readable.from([Buffer.from('{"foo":"bar"}\n')]),
      'JSONEachRow'
    )
    const singleRows: Row[] = []
    for await (const r of rows.stream()) {
      singleRows.push(r)
    }
    expect(singleRows).toHaveLength(1)
    const [row] = singleRows
    expect(row.text()).toEqual('{"foo":"bar"}')
    expect(row.text()).toEqual('{"foo":"bar"}')
    expect(row.json()).toEqual({ foo: 'bar' })
    expect(row.json()).toEqual({ foo: 'bar' })
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
