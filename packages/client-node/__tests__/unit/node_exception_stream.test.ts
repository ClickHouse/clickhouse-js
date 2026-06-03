import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { describe, expect, it } from 'vitest'
import { ResultSet } from '../../src'
import {
  ClickHouseException,
  ClickHouseExceptionStream,
  ClickHouseStreamError,
} from '../../src/utils/exception_stream'

const CRLF = Buffer.from('\r\n')
const MARKER = Buffer.from('__exception__')
const TAG = 'dmrdfnujjqvszhav'

const MSG =
  "Code: 395. DB::Exception: Value passed to 'throwIf' function is non-zero. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 25.11.1.1)"

function buildBlock(tag: string, message: string): Buffer {
  const msg = Buffer.from(message, 'utf8')
  return Buffer.concat([
    CRLF,
    MARKER,
    CRLF,
    Buffer.from(tag),
    CRLF,
    msg,
    CRLF,
    Buffer.from(`${msg.length} ${tag}`),
    CRLF,
    MARKER,
    CRLF,
  ])
}

function chunked(buf: Buffer, size: number): Buffer[] {
  const out: Buffer[] = []
  for (let i = 0; i < buf.length; i += size) out.push(buf.subarray(i, i + size))
  return out
}

async function collect(
  chunks: Buffer[],
  tag = TAG,
  opts: { throwOnException?: boolean } = {},
): Promise<{
  data: Buffer
  error: Error | null
  exception: ClickHouseException | null
}> {
  const parser = new ClickHouseExceptionStream({
    tag,
    throwOnException: opts.throwOnException ?? true,
  })
  const collected: Buffer[] = []
  parser.on('data', (c: Buffer) => collected.push(c))
  let error: Error | null = null
  try {
    await pipeline(Readable.from(chunks), parser)
  } catch (e) {
    error = e as Error
  }
  return {
    data: Buffer.concat(collected),
    error,
    exception: parser.getException(),
  }
}

describe('ClickHouseExceptionStream', () => {
  it('passes data through when there is no exception', async () => {
    const body = Buffer.from('0,0\n0,0\n0,0\n')
    const r = await collect(chunked(body, 7))
    expect(r.data.equals(body)).toBe(true)
    expect(r.error).toBeNull()
    expect(r.exception).toBeNull()
  })

  it('detects an exception delivered in a single chunk', async () => {
    const data = Buffer.from('0,0\n0,0\n')
    const body = Buffer.concat([data, buildBlock(TAG, MSG)])
    const r = await collect([body])
    expect(r.data.equals(data)).toBe(true)
    expect(r.error).toBeInstanceOf(ClickHouseException)
    expect(r.exception?.code).toBe(395)
    expect(r.exception?.errorName).toBe('FUNCTION_THROW_IF_VALUE_IS_NON_ZERO')
    expect(r.exception?.message).toBe(MSG)
  })

  it('detects an exception split across 1-byte chunks', async () => {
    const data = Buffer.from('0,0\n0,0\n')
    const body = Buffer.concat([data, buildBlock(TAG, MSG)])
    const r = await collect(chunked(body, 1))
    expect(r.data.equals(data)).toBe(true)
    expect(r.exception?.code).toBe(395)
  })

  it('preserves large data (> 16 KiB) that forces early release', async () => {
    const data = Buffer.from('x'.repeat(50_000))
    const body = Buffer.concat([data, buildBlock(TAG, MSG)])
    const r = await collect(chunked(body, 4096))
    expect(r.data.equals(data)).toBe(true)
    expect(r.exception?.code).toBe(395)
  })

  it('extracts a message that itself contains the literal marker', async () => {
    const trickyMsg =
      'Code: 62. DB::Exception: bad token __exception__ here. (SYNTAX_ERROR) (version 25.11.1.1)'
    const data = Buffer.from('row1\n')
    const body = Buffer.concat([data, buildBlock(TAG, trickyMsg)])
    const r = await collect([body])
    expect(r.data.equals(data)).toBe(true)
    expect(r.exception?.message).toBe(trickyMsg)
    expect(r.exception?.code).toBe(62)
  })

  it('treats a marker without a matching tag as plain data', async () => {
    const body = Buffer.from('{"s":"__exception__ in a string value"}\n')
    const r = await collect([body])
    expect(r.data.equals(body)).toBe(true)
    expect(r.exception).toBeNull()
    expect(r.error).toBeNull()
  })

  it('errors with ClickHouseStreamError on a truncated block', async () => {
    const data = Buffer.from('0,0\n')
    const partial = Buffer.concat([
      data,
      CRLF,
      MARKER,
      CRLF,
      Buffer.from(TAG),
      CRLF,
      Buffer.from('Code: 1. DB::Excep'),
    ])
    const r = await collect(chunked(partial, 3))
    expect(r.error).toBeInstanceOf(ClickHouseStreamError)
  })

  it('ends cleanly and exposes the exception when throwOnException is false', async () => {
    const data = Buffer.from('0,0\n')
    const body = Buffer.concat([data, buildBlock(TAG, MSG)])
    const r = await collect([body], TAG, { throwOnException: false })
    expect(r.error).toBeNull()
    expect(r.exception?.code).toBe(395)
    expect(r.data.equals(data)).toBe(true)
  })

  it('emits a clickhouse-exception event', async () => {
    const data = Buffer.from('0,0\n')
    const body = Buffer.concat([data, buildBlock(TAG, MSG)])
    const parser = new ClickHouseExceptionStream({
      tag: TAG,
      throwOnException: false,
    })
    let eventEx: ClickHouseException | null = null
    parser.on('clickhouse-exception', (ex: ClickHouseException) => {
      eventEx = ex
    })
    parser.on('data', () => {})
    await pipeline(Readable.from([body]), parser)
    expect(eventEx).not.toBeNull()
    expect((eventEx as unknown as ClickHouseException).code).toBe(395)
  })

  it('requires a tag', () => {
    expect(() => new ClickHouseExceptionStream({ tag: '' })).toThrow(TypeError)
  })
})

describe('ResultSet optional exception stream', () => {
  const headers = { 'x-clickhouse-exception-tag': TAG }

  it('surfaces an in-band exception when enabled', async () => {
    const data = Buffer.from('{"a":1}\n{"a":2}\n')
    const body = Buffer.concat([data, buildBlock(TAG, MSG)])
    const rs = ResultSet.instance({
      stream: Readable.from(chunked(body, 5)),
      format: 'JSONEachRow',
      query_id: 'test',
      log_error: () => {},
      response_headers: headers,
      exceptionStream: true,
    })

    const rows: unknown[] = []
    let error: Error | null = null
    try {
      for await (const batch of rs.stream()) {
        for (const row of batch) rows.push(row.json())
      }
    } catch (e) {
      error = e as Error
    }
    expect(error).toBeInstanceOf(ClickHouseException)
    expect((error as ClickHouseException).code).toBe(395)
  })

  it('passes data through when enabled and there is no exception', async () => {
    const data = Buffer.from('{"a":1}\n{"a":2}\n')
    const rs = ResultSet.instance({
      stream: Readable.from([data]),
      format: 'JSONEachRow',
      query_id: 'test',
      log_error: () => {},
      response_headers: headers,
      exceptionStream: true,
    })

    const rows: unknown[] = []
    for await (const batch of rs.stream()) {
      for (const row of batch) rows.push(row.json())
    }
    expect(rows).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('is disabled by default (transformer not plugged in)', async () => {
    const data = Buffer.from('{"a":1}\n')
    const rs = ResultSet.instance({
      stream: Readable.from([data]),
      format: 'JSONEachRow',
      query_id: 'test',
      log_error: () => {},
      response_headers: headers,
    })

    const rows: unknown[] = []
    for await (const batch of rs.stream()) {
      for (const row of batch) rows.push(row.json())
    }
    expect(rows).toEqual([{ a: 1 }])
  })
})
