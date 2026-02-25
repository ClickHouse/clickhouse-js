import { describe, it, expect, vi, beforeAll } from 'vitest'
import {
  DefaultLogger,
  LogWriter,
  ClickHouseLogLevel,
} from '@clickhouse/client-common'
import { drainStream, type Context } from '../../src/connection/stream'
import stream from 'stream'

describe(drainStream, () => {
  let log_writer: LogWriter
  let context: Context

  beforeAll(() => {
    log_writer = new LogWriter(
      new DefaultLogger(),
      'Connection',
      ClickHouseLogLevel.OFF,
    )
    context = {
      op: 'Insert',
      query_id: 'test-query-id',
      log_writer,
      log_level: ClickHouseLogLevel.OFF,
    }
  })
  it('resolves when the stream ends', async () => {
    let ended = false
    const readable = new stream.Readable({
      read() {
        this.push('data')
        this.push(null) // end the stream
        ended = true
      },
    })

    expect(ended).toBe(false)
    await expect(drainStream(context, readable)).resolves.toBeUndefined()
    expect(ended).toBe(true)
  })

  it('resolves when the stream is already ended', async () => {
    let ended = false
    const readable = new stream.Readable({
      read() {
        this.push('data')
        this.push(null) // end the stream
        ended = true
      },
    })

    expect(ended).toBe(false)
    for await (const _ of readable) {
      // consume the stream
    }
    expect(ended).toBe(true)
    await expect(drainStream(context, readable)).resolves.toBeUndefined()
  })

  it('rejects when the stream emits an error', async () => {
    let errored = false
    const readable = new stream.Readable({
      read() {
        this.emit('error', new Error('Stream error A'))
        errored = true
      },
    })

    expect(errored).toBe(false)
    await expect(drainStream(context, readable)).rejects.toThrow(
      'Stream error A',
    )
    expect(errored).toBe(true)
  })

  it('rejects when the stream throws', async () => {
    let errored = false
    const readable = new stream.Readable({
      read() {
        errored = true
        throw new Error('Stream error B')
      },
    })

    expect(errored).toBe(false)
    await expect(drainStream(context, readable)).rejects.toThrow('Stream error')
    expect(errored).toBe(true)
  })

  it('resolves when the stream is already errored', async () => {
    let errored = false
    const readable = new stream.Readable({
      read() {
        this.emit('error', new Error('Stream error C'))
        errored = true
      },
    })

    expect(errored).toBe(false)
    try {
      for await (const _ of readable) {
        // consume the stream
      }
    } catch {}
    expect(errored).toBe(true)
    await expect(drainStream(context, readable)).rejects.toThrow(
      'The operation was aborted',
    )
  })

  it('resolves when the stream is already closed', async () => {
    let closed = false
    const readable = new stream.Readable({
      read() {
        this.push('data')
        this.push(null) // end the stream
        closed = true
      },
    })

    expect(closed).toBe(false)
    for await (const _ of readable) {
      // consume the stream
    }
    expect(closed).toBe(true)
    await expect(drainStream(context, readable)).resolves.toBeUndefined()
  })
})
