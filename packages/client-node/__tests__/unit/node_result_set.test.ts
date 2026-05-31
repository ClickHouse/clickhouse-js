import {
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
  vi,
} from 'vitest'
import type { DataFormat, Row } from '@clickhouse/client-common'
import { guid } from '../../../client-common/__tests__/utils/guid'
import Stream, { Readable } from 'stream'
import { ResultSet } from '../../src'
import { isUsingStatementSupported } from '../utils/feature_detection'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('[Node.js] ResultSet', () => {
  const expectedText = `{"foo":"bar"}\n{"qaz":"qux"}\n`
  const expectedJson = [{ foo: 'bar' }, { qaz: 'qux' }]

  const errMsg = 'Stream has been already consumed'
  const err = expect.objectContaining({
    message: expect.stringContaining(errMsg),
  })

  async function collect(stream: Stream.Readable): Promise<Buffer> {
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks)
  }

  it('should consume the response as text only once', async () => {
    const rs = makeResultSet(getDataStream())

    expect(await rs.text()).toEqual(expectedText)
    await expect(rs.text()).rejects.toEqual(err)
    await expect(rs.json()).rejects.toEqual(err)
  })

  it('should consume the response as JSON only once', async () => {
    const rs = makeResultSet(getDataStream())
    expect(await rs.json()).toEqual(expectedJson)
    await expect(rs.json()).rejects.toEqual(err)
    await expect(rs.text()).rejects.toEqual(err)
  })

  it('should consume the response as a stream of Row instances', async () => {
    const rs = makeResultSet(getDataStream())
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
    await expect(rs.json()).rejects.toEqual(err)
    await expect(rs.text()).rejects.toEqual(err)
  })

  // Regression test for https://github.com/ClickHouse/clickhouse-js/issues/575
  // The old code used readableEnded to track consumption, which could become
  // true before json() is called (for fast/small responses). The fix uses a
  // _consumed boolean flag that only our code controls.
  it('should succeed on json() even if readableEnded is already true', async () => {
    const stream = Readable.from([Buffer.from('{"n":1}\n')])

    // Force readableEnded=true to deterministically simulate a fast response
    // that has already ended before json() is called.
    Object.defineProperty(stream, 'readableEnded', {
      get: () => true,
      configurable: true,
    })

    const rs = makeResultSet(stream)
    // Old code would throw "Stream has been already consumed" here
    // because it checked readableEnded. New code only checks _consumed.
    const result = await rs.json()
    expect(result).toEqual([{ n: 1 }])
  })

  // Verify that calling json() on a non-JSON format (e.g. CSV) does not
  // permanently mark the ResultSet as consumed — text() should still work.
  it('should allow text() after json() throws for unsupported format', async () => {
    const rs = makeResultSet(
      Stream.Readable.from([Buffer.from('1,"foo"\n')]),
      'CSV',
    )
    await expect(rs.json()).rejects.toThrow('Cannot decode CSV as JSON')
    // ResultSet should NOT be consumed — text() should still work
    const text = await rs.text()
    expect(text).toEqual('1,"foo"\n')
  })

  // Verify that calling stream() on a non-streamable format does not
  // permanently mark the ResultSet as consumed — text() should still work.
  it('should allow text() after stream() throws for invalid format', async () => {
    const rs = makeResultSet(
      Stream.Readable.from([Buffer.from('{"data":[1,2,3]}')]),
      'JSON',
    )
    expect(() => rs.stream()).toThrow()
    // ResultSet should NOT be consumed — text() should still work
    const text = await rs.text()
    expect(text).toEqual('{"data":[1,2,3]}')
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

  describe.skip('unhandled exceptions with streamable JSON formats', () => {
    const logAndQuit = (err: Error | unknown, prefix: string) => {
      console.error(prefix, err)
      expect.fail(
        `An unexpected error was propagated to the global context: ${prefix} ${err}`,
      )
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
        await expect(jsonPromise).rejects.toEqual(
          expect.objectContaining({
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
        await expect(jsonPromise).rejects.toEqual(
          expect.objectContaining({
            name: 'SyntaxError',
          }),
        )
      })
    })
  })

  describe('binaryStream', () => {
    // Regression test for https://github.com/ClickHouse/clickhouse-js/issues/607
    // Binary formats such as Parquet contain \r\n byte sequences that the
    // row-oriented stream() parser misinterprets as the exception marker.
    const binaryWithCRLF = Buffer.from([
      1, 2, 0x0d, 0x0a, 3, 4, 0x0d, 0x0a, 0x0d, 0x0a, 5, 6, 7, 8, 9, 10,
    ])
    const exceptionTag = 'FOOBAR'

    it('should yield raw binary chunks without splitting on newlines', async () => {
      const rs = makeResultSet(Readable.from([binaryWithCRLF]), 'Parquet', {
        'x-clickhouse-exception-tag': exceptionTag,
      })
      const result = await collect(rs.binaryStream())
      expect(Array.from(result)).toEqual(Array.from(binaryWithCRLF))
    })

    it('should pass data through unchanged without an exception tag', async () => {
      const rs = makeResultSet(Readable.from([binaryWithCRLF]), 'Parquet')
      const result = await collect(rs.binaryStream())
      expect(Array.from(result)).toEqual(Array.from(binaryWithCRLF))
    })

    it('should propagate a mid-stream exception', async () => {
      const errMsg = 'boom'
      const exceptionBlock = Buffer.from(
        '\r\n__exception__\r\n' +
          exceptionTag +
          '\n' +
          errMsg +
          '\n' +
          (errMsg.length + 1) +
          ' ' +
          exceptionTag +
          '\r\n__exception__\r\n',
      )
      const rs = makeResultSet(
        Readable.from([Buffer.concat([binaryWithCRLF, exceptionBlock])]),
        'Parquet',
        { 'x-clickhouse-exception-tag': exceptionTag },
      )
      await expect(collect(rs.binaryStream())).rejects.toThrow(errMsg)
    })

    it('should mark the ResultSet as consumed', async () => {
      const rs = makeResultSet(Readable.from([binaryWithCRLF]), 'Parquet')
      await collect(rs.binaryStream())
      await expect(rs.text()).rejects.toEqual(err)
    })
  })

  describe('rawStream', () => {
    it('should return the underlying stream as-is', async () => {
      const stream = Readable.from([Buffer.from([1, 2, 3])])
      const rs = makeResultSet(stream, 'Parquet')

      expect(rs.rawStream()).toBe(stream)
      await expect(rs.text()).rejects.toEqual(err)
    })

    it('should not intercept a trailing exception block', async () => {
      const exceptionTag = 'FOOBAR'
      const errMsg = 'boom'
      const exceptionBlock = Buffer.from(
        '\r\n__exception__\r\n' +
          exceptionTag +
          '\n' +
          errMsg +
          '\n' +
          (errMsg.length + 1) +
          ' ' +
          exceptionTag +
          '\r\n__exception__\r\n',
      )
      const stream = Readable.from([exceptionBlock])
      const rs = makeResultSet(stream, 'Parquet', {
        'x-clickhouse-exception-tag': exceptionTag,
      })

      const result = await collect(rs.rawStream())
      expect(Array.from(result)).toEqual(Array.from(exceptionBlock))
    })
  })

  it('closes the ResultSet when used with using statement', async (context) => {
    if (!isUsingStatementSupported()) {
      context.skip('using statement is not supported in this environment')
      return
    }
    const rs = makeResultSet(getDataStream())
    let isClosed = false
    vi.spyOn(rs, 'close').mockImplementation(() => {
      // Simulate some delay in closing
      isClosed = true
    })

    // Wrap in eval to allow using statement syntax without
    // syntax error in older Node.js versions. Might want to
    // consider using a separate test file for this in the future.
    await eval(`
      ((value) => {
          using c = value;
          // do nothing, just testing the disposal at the end of the block
      })
    `)(rs)

    expect(isClosed).toBe(true)
  })

  function makeResultSet(
    stream: Stream.Readable,
    format: DataFormat = 'JSONEachRow',
    response_headers: Record<string, string> = {},
  ) {
    return ResultSet.instance({
      stream,
      format,
      query_id: guid(),
      log_error: (err) => {
        console.error(err)
      },
      response_headers,
    })
  }

  function getDataStream() {
    return Readable.from([
      Buffer.from('{"foo":"bar"}\n'),
      Buffer.from('{"qaz":"qux"}\n'),
    ])
  }
})
