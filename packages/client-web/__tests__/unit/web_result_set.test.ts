import { describe, it, expect, vi } from 'vitest'
import type { Row } from '@clickhouse/client-common'
import { guid } from '@test/utils'
import { ResultSet } from '../../src'
import { isAwaitUsingStatementSupported } from '../utils/feature_detection'
import { sleep } from '../utils/sleep'

describe('[Web] ResultSet', () => {
  const expectedText = `{"foo":"bar"}\n{"qaz":"qux"}\n`
  const expectedJson = [{ foo: 'bar' }, { qaz: 'qux' }]

  const errMsg = 'Stream has been already consumed'
  const err = expect.objectContaining({
    message: expect.stringContaining(errMsg),
  })

  it('should consume the response as text only once', async () => {
    const rs = makeResultSet()

    expect(await rs.text()).toEqual(expectedText)
    await expect(rs.text()).rejects.toMatchObject(err)
    await expect(rs.json()).rejects.toMatchObject(err)
  })

  it('should consume the response as JSON only once', async () => {
    const rs = makeResultSet()

    expect(await rs.json()).toEqual(expectedJson)
    await expect(rs.json()).rejects.toMatchObject(err)
    await expect(rs.text()).rejects.toMatchObject(err)
  })

  it('should consume the response as a stream of Row instances', async () => {
    const rs = makeResultSet()
    const stream = rs.stream()

    const result: unknown[] = []
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      value.forEach((row) => {
        result.push(row.json())
      })
    }

    expect(result).toEqual(expectedJson)
    expect(() => rs.stream()).toThrow(new Error(errMsg))
    await expect(rs.json()).rejects.toMatchObject(err)
    await expect(rs.text()).rejects.toMatchObject(err)
  })

  it('should be able to call Row.text and Row.json multiple times', async () => {
    const rs = new ResultSet(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"foo":"bar"}\n'))
          controller.close()
        },
      }),
      'JSONEachRow',
      guid(),
    )

    const allRows: Row[] = []
    const reader = rs.stream().getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      allRows.push(...value)
    }
    expect(allRows.length).toEqual(1)

    const [row] = allRows
    expect(row.text).toEqual('{"foo":"bar"}')
    expect(row.text).toEqual('{"foo":"bar"}')
    expect(row.json()).toEqual({ foo: 'bar' })
    expect(row.json()).toEqual({ foo: 'bar' })
  })

  it('closes the ResultSet when used with using statement', async ({
    skip,
  }) => {
    if (!isAwaitUsingStatementSupported()) {
      skip('using statement is not supported in this environment')
      return
    }
    const rs = makeResultSet()
    let isClosed = false
    vi.spyOn(rs, 'close').mockImplementation(async () => {
      // Simulate some delay in closing
      await sleep(0)
      isClosed = true
    })

    // Wrap in eval to allow using statement syntax without
    // syntax error in older Node.js versions. Might want to
    // consider using a separate test file for this in the future.
    await eval(`
      (async (value) => {
          await using c = value;
          // do nothing, just testing the disposal at the end of the block
      })
    `)(rs)

    expect(isClosed).toBeTruthy()
  })

  describe('rawStream', () => {
    // Regression test for https://github.com/ClickHouse/clickhouse-js/issues/607
    const binaryWithCRLF = new Uint8Array([
      1, 2, 0x0d, 0x0a, 3, 4, 0x0d, 0x0a, 0x0d, 0x0a, 5, 6, 7, 8, 9, 10,
    ])
    const exceptionTag = 'FOOBAR'

    function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
      return new ReadableStream({
        start(controller) {
          chunks.forEach((chunk) => controller.enqueue(chunk))
          controller.close()
        },
      })
    }

    function makeRawResultSet(
      stream: ReadableStream<Uint8Array>,
      response_headers: Record<string, string> = {},
    ) {
      return new ResultSet(stream, 'Parquet', guid(), response_headers)
    }

    async function collect(
      stream: ReadableStream<Uint8Array>,
    ): Promise<Uint8Array> {
      const reader = stream.getReader()
      const chunks: number[] = []
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(...value)
      }
      return new Uint8Array(chunks)
    }

    it('should yield raw binary chunks without splitting on newlines', async () => {
      const rs = makeRawResultSet(streamOf(binaryWithCRLF), {
        'x-clickhouse-exception-tag': exceptionTag,
      })
      const result = await collect(rs.rawStream())
      expect(Array.from(result)).toEqual(Array.from(binaryWithCRLF))
    })

    it('should pass data through unchanged without an exception tag', async () => {
      const rs = makeRawResultSet(streamOf(binaryWithCRLF))
      const result = await collect(rs.rawStream())
      expect(Array.from(result)).toEqual(Array.from(binaryWithCRLF))
    })

    it('should propagate a mid-stream exception', async () => {
      const errMsg = 'boom'
      const exceptionBlock = new TextEncoder().encode(
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
      const full = new Uint8Array(binaryWithCRLF.length + exceptionBlock.length)
      full.set(binaryWithCRLF, 0)
      full.set(exceptionBlock, binaryWithCRLF.length)
      const rs = makeRawResultSet(streamOf(full), {
        'x-clickhouse-exception-tag': exceptionTag,
      })
      await expect(collect(rs.rawStream())).rejects.toThrow(errMsg)
    })

    it('should mark the ResultSet as consumed', async () => {
      const rs = makeRawResultSet(streamOf(binaryWithCRLF))
      await collect(rs.rawStream())
      await expect(rs.text()).rejects.toMatchObject(err)
    })
  })

  function makeResultSet() {
    return new ResultSet(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(encoder.encode('{"foo":"bar"}\n'))
          controller.enqueue(encoder.encode('{"qaz":"qux"}\n'))
          controller.close()
        },
      }),
      'JSONEachRow',
      guid(),
    )
  }
})
