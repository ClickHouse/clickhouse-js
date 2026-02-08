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
  const err = jasmine.objectContaining({
    message: jasmine.stringContaining(errMsg),
  })

  it('should consume the response as text only once', async () => {
    const rs = makeResultSet()

    expect(await rs.text()).toEqual(expectedText)
    await expectAsync(rs.text()).toBeRejectedWith(err)
    await expectAsync(rs.json()).toBeRejectedWith(err)
  })

  it('should consume the response as JSON only once', async () => {
    const rs = makeResultSet()

    expect(await rs.json()).toEqual(expectedJson)
    await expectAsync(rs.json()).toBeRejectedWith(err)
    await expectAsync(rs.text()).toBeRejectedWith(err)
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
    await expectAsync(rs.json()).toBeRejectedWith(err)
    await expectAsync(rs.text()).toBeRejectedWith(err)
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

  it('closes the ResultSet when used with using statement', async () => {
    if (!isAwaitUsingStatementSupported()) {
      pending('using statement is not supported in this environment')
      return
    }
    const rs = makeResultSet()
    let isClosed = false
    spyOn(rs, 'close').and.callFake(async () => {
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

    expect(isClosed).toBeTrue()
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
