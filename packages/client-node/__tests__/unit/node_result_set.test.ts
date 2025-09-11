import type { DataFormat, Row } from '@clickhouse/client-common'
import { guid } from '@test/utils'
import Stream, { Readable } from 'stream'
import { ResultSet } from '../../src'

describe('[Node.js] ResultSet', () => {
  const expectedText = `{"foo":"bar"}\n{"qaz":"qux"}\n`
  const expectedJson = [{ foo: 'bar' }, { qaz: 'qux' }]

  const errMsg = 'Stream has been already consumed'
  const err = jasmine.objectContaining({
    message: jasmine.stringContaining(errMsg),
  })

  it('should consume the response as text only once', async () => {
    const rs = makeResultSet(getDataStream())

    expect(await rs.text()).toEqual(expectedText)
    await expectAsync(rs.text()).toBeRejectedWith(err)
    await expectAsync(rs.json()).toBeRejectedWith(err)
  })

  it('should consume the response as JSON only once', async () => {
    const rs = makeResultSet(getDataStream())
    expect(await rs.json()).toEqual(expectedJson)
    await expectAsync(rs.json()).toBeRejectedWith(err)
    await expectAsync(rs.text()).toBeRejectedWith(err)
  })

  it('should consume the response as a stream of Row instances', async () => {
    const rs = makeResultSet(getDataStream())
    const stream = rs.stream()
    expect(stream.readableEnded).toBeFalsy()

    const result: Array<unknown> = []
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
    const allRows: Array<Row> = []
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

  describe('unhandled exceptions with streamable JSON formats', () => {
    const logAndQuit = (err: Error | unknown, prefix: string) => {
      console.error(prefix, err)
      process.exit(1)
    }
    const uncaughtExceptionListener = (err: Error) =>
      logAndQuit(err, 'uncaughtException:')
    const unhandledRejectionListener = (err: unknown) =>
      logAndQuit(err, 'unhandledRejection:')

    const invalidJSON = 'invalid":"foo"}\n'

    beforeAll(() => {
      process.on('uncaughtException', uncaughtExceptionListener)
      process.on('unhandledRejection', unhandledRejectionListener)
    })
    afterAll(() => {
      process.off('uncaughtException', uncaughtExceptionListener)
      process.off('unhandledRejection', unhandledRejectionListener)
    })

    describe('Streamable JSON formats - JSONEachRow', () => {
      it('should not be produced (ResultSet.text)', async () => {
        const rs = makeResultSet(
          Stream.Readable.from([Buffer.from(invalidJSON)]),
        )
        const text = await rs.text()
        expect(text).toEqual(invalidJSON)
      })

      it('should not be produced (ResultSet.json)', async () => {
        const rs = makeResultSet(
          Stream.Readable.from([Buffer.from(invalidJSON)]),
        )
        const jsonPromise = rs.json()
        await expectAsync(jsonPromise).toBeRejectedWith(
          jasmine.objectContaining({
            name: 'SyntaxError',
          }),
        )
      })
    })

    describe('Non-streamable JSON formats - JSON', () => {
      it('should not be produced (ResultSet.text)', async () => {
        const rs = makeResultSet(
          Stream.Readable.from([Buffer.from(invalidJSON)]),
          'JSON',
        )
        const text = await rs.text()
        expect(text).toEqual(invalidJSON)
      })

      it('should not be produced (ResultSet.json)', async () => {
        const rs = makeResultSet(
          Stream.Readable.from([Buffer.from(invalidJSON)]),
          'JSON',
        )
        const jsonPromise = rs.json()
        await expectAsync(jsonPromise).toBeRejectedWith(
          jasmine.objectContaining({
            name: 'SyntaxError',
          }),
        )
      })
    })
  })

  function makeResultSet(
    stream: Stream.Readable,
    format: DataFormat = 'JSONEachRow',
  ) {
    return ResultSet.instance({
      stream,
      format,
      query_id: guid(),
      log_error: (err) => {
        console.error(err)
      },
      response_headers: {},
    })
  }

  function getDataStream() {
    return Readable.from([
      Buffer.from('{"foo":"bar"}\n'),
      Buffer.from('{"qaz":"qux"}\n'),
    ])
  }
})
