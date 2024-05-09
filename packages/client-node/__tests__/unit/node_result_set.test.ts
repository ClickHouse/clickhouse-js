import type { Row } from '@clickhouse/client-common'
import { guid } from '@test/utils'
import Stream, { Readable } from 'stream'
import { ResultSet } from '../../src'

describe('[Node.js] ResultSet', () => {
  const dataStream = Readable.from([
    Buffer.from('{"foo":"bar"}\n'),
    Buffer.from('{"qaz":"qux"}\n'),
  ])
  const expectedText = `{"foo":"bar"}\n{"qaz":"qux"}\n`
  const expectedJson = [{ foo: 'bar' }, { qaz: 'qux' }]

  const errMsg = 'Stream has been already consumed'
  const err = jasmine.objectContaining({
    message: jasmine.stringContaining(errMsg),
  })

  it('should consume the response as text only once', async () => {
    const rs = makeResultSet(dataStream)

    expect(await rs.text()).toEqual(expectedText)
    await expectAsync(rs.text()).toBeRejectedWith(err)
    await expectAsync(rs.json()).toBeRejectedWith(err)
  })

  it('should consume the response as JSON only once', async () => {
    const rs = makeResultSet(dataStream)

    expect(await rs.json()).toEqual(expectedJson)
    await expectAsync(rs.json()).toBeRejectedWith(err)
    await expectAsync(rs.text()).toBeRejectedWith(err)
  })

  it('should consume the response as a stream of Row instances', async () => {
    const rs = makeResultSet(dataStream)
    const stream = rs.stream()

    expect(stream.readableEnded).toBeFalsy()

    const result: unknown[] = []
    for await (const rows of stream) {
      rows.forEach((row: Row) => {
        result.push(row.json())
      })
    }

    expect(result).toEqual(expectedJson)
    expect(stream.readableEnded).toBeTruthy()

    expect(() => rs.stream()).toThrow(new Error(errMsg))
    await expectAsync(rs.json()).toBeRejectedWith(err)
    await expectAsync(rs.text()).toBeRejectedWith(err)
  })

  it('should be able to call Row.text and Row.json multiple times', async () => {
    const rs = makeResultSet(
      Stream.Readable.from([Buffer.from('{"foo":"bar"}\n')]),
    )
    const allRows: Row[] = []
    for await (const rows of rs.stream()) {
      allRows.push(...rows)
    }
    expect(allRows.length).toEqual(1)
    const [row] = allRows
    expect(row.text).toEqual('{"foo":"bar"}')
    expect(row.text).toEqual('{"foo":"bar"}')
    expect(row.json()).toEqual({ foo: 'bar' })
    expect(row.json()).toEqual({ foo: 'bar' })
  })

  function makeResultSet(stream: Stream.Readable) {
    return ResultSet.instance({
      stream,
      format: 'JSONEachRow',
      query_id: guid(),
      log_error: (err) => {
        console.error(err)
      },
    })
  }
})
